const express = require("express");
const crypto = require("crypto");
const { title } = require("process");
const port = 3000;
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const cookieParser = require("cookie-parser");
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(cookieParser());
app.use(session({
    secret: 'secretWarehouseKey123456789', // Change this in production
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

// static resource & templating engine
app.use(express.static('public'));
// Set EJS as templating engine
app.set('view engine', 'ejs');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storageConfig = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, 'public/img/product_image'));
    },
    filename: function (req, file, cb) {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const date = String(d.getDate()).padStart(2, '0');
        const milli = String(d.getMilliseconds()).padStart(3, '0');
        const prefix = `${year}${month}${date}_${milli}`;
        cb(null, prefix + '_' + file.originalname);
    }
});

// Connect to SQLite database
let db = new sqlite3.Database('Warehouse.db', (err) => {
    if (err) {
        return console.error(err.message);
    }
    console.log('Connected to the SQlite database.');
    loadData();
});

const uploader = multer({ storage: storageConfig });

function loadData() {
    db.all(`SELECT * FROM Categories ORDER BY category_name`, [], (err, categories) => {
        if (!err) app.locals.categories = categories;
    });
    db.all(`SELECT * FROM Brands ORDER BY brand_name`, [], (err, brands) => {
        if (!err) app.locals.brands = brands;
    });
    db.all(`SELECT * FROM Suppliers ORDER BY supplier_name`, [], (err, suppliers) => {
        if (!err) app.locals.suppliers  = suppliers;
    });
}

// ==========================================
// 1. AUTHENTICATION MIDDLEWARE
// ==========================================
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        // Pass user data to res.locals so ALL EJS views can access it automatically
        res.locals.user = req.session.user; 
        return next();
    } else {
        // If not logged in, kick them back to login page
        res.redirect("/?error=notfound");
    }
}

function authorizeRoles(allowedRoles) {
    return (req, res, next) => {
        // 1. Double-check they are logged in (though isAuthenticated should catch this)
        if (!req.session || !req.session.user) {
            return res.redirect("/?error=notfound");
        }

        // 2. Check if their role is inside the allowed array
        const userRole = req.session.user.role; // e.g., "Manager" or "Staff"

        if (allowedRoles.includes(userRole)) {
            // They have permission! Let them pass.
            return next(); 
        } else {
            // They are logged in, but DO NOT have permission for this specific route
            // You can render a nice error page here, or just send a 403 Forbidden status
            return res.status(403).send(`
                <div style="text-align:center; margin-top: 50px; font-family: sans-serif;">
                    <h1>🛑 403 Forbidden</h1>
                    <p>ขออภัย คุณไม่มีสิทธิ์เข้าถึงหน้านี้ (ต้องการสิทธิ์ระดับ: ${allowedRoles.join(" หรือ ")})</p>
                    <a href="/dashboard">กลับไปหน้าหลัก</a>
                </div>
            `);
        }
    }
}

// ==========================================
// 2. PUBLIC ROUTES (No login required)
// ==========================================
app.get("/", (req, res) => {
    // If they are already logged in, send them straight to the dashboard
    if (req.session.user) {
        return res.redirect("/dashboard");
    }

    let errorMessage = null;
    if (req.query.error === "notfound") {
        errorMessage = "ไม่พบบัญชีผู้ใช้งาน หรืออีเมลนี้ในระบบ / กรุณาเข้าสู่ระบบ";
    } else if (req.query.error === "inactive") {
        errorMessage = "บัญชีนี้ถูกระงับการใช้งาน";
    } else if (req.query.error === "wrongpassword") {
        errorMessage = "รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง";
    }

    res.render("login", { error: errorMessage });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;

    const sql = `SELECT Users.username, Users.password, Users.status, Users.role, Employees.first_name, Employees.last_name
        FROM Users 
        INNER JOIN Employees ON Users.employee_id = Employees.employee_id 
        WHERE Users.username = ? OR Employees.email = ?`;

    db.get(sql, [username, username], (err, row) => {
        if (err) return res.status(500).send(err.message);
        if (!row) return res.redirect("/?error=notfound");
        if (row.status === "Inactive") return res.redirect("/?error=inactive");

        const savedPassword = row.password;
        const [salt, originalHash] = savedPassword.split(":");

        crypto.scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) return res.status(500).send("Hashing error");

            const attemptHash = derivedKey.toString("hex");

            if (attemptHash === originalHash) {
                // Save complete user info to session
                req.session.user = {
                    username: row.username,
                    role: row.role,
                    firstName: row.first_name,
                    lastName: row.last_name
                };
                res.redirect("/dashboard");
            } else {
                res.redirect("/?error=wrongpassword");
            }
        });
    });
});

app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
            return res.status(500).send("Error logging out.");
        }
        // Clear the cookie and go to login
        res.clearCookie('connect.sid');
        res.redirect("/");
    });
});

// ==========================================
// 3. PROTECTED ROUTES (Requires Login)
// Apply the 'isAuthenticated' middleware to all below
// ==========================================

app.get("/dashboard", isAuthenticated, (req, res) => {
    // You don't need to pass { username: ... } manually anymore because res.locals.user is set
    res.render("home");
});

app.get("/mainpage", isAuthenticated, (req, res) => res.render("mainpage"));

// ==========================================
// หน้าประวัติ
app.get("/history", isAuthenticated, (req, res) => {
    const { username, data, type } = req.query; 

    let sql = `
        SELECT 
            t.trans_id, 
            p.product_name, 
            t.change_amount, 
            t.trans_date, 
            t.trans_type, 
            e.first_name || ' ' || e.last_name AS staff_name
        FROM Transactions t
        JOIN Products p ON t.product_id = p.product_id
        JOIN Employees e ON t.employee_id = e.employee_id
        WHERE 1=1
    `;
    
    const params = [];

    if (username) {
        sql += ` AND p.product_name LIKE ?`;
        params.push(`%${username}%`);
    }
    if (data) {
        sql += ` AND DATE(t.trans_date) = ?`;
        params.push(data);
    }
    if (type) {
        sql += ` AND t.trans_type = ?`;
        params.push(type);
    }

    sql += ` ORDER BY t.trans_date DESC`;

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error("SQL Error:", err.message);
            return res.status(500).send("Database error");
        }
        
        res.render("history", { 
            historyData: rows, 
            query: req.query  
        });
    });
});

// ==========================================

app.get("/report", isAuthenticated, (req, res) => res.render("report"));
app.get("/createReport", isAuthenticated, (req, res) => res.render("createReport"));
app.get("/manageEdit", isAuthenticated, (req, res) => res.render("manageEdit"));
app.get("/undefind", isAuthenticated, (req, res) => res.render("undefind")); // Typo kept for your routing

// --- User Management Routes ---
app.get("/manage", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    const sql = `
        SELECT u.*, e.employee_id, e.first_name, e.last_name
        FROM Users u
        LEFT JOIN Employees e ON u.employee_id = e.employee_id
        ORDER BY e.employee_id ASC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).send("เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้งาน");
        res.render("manage", { users: rows });
    });
});

app.get("/addUser", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    res.render("addUser", { error: null });
});

app.get("/add-user", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    res.render("manageEdit", { user: null, title: 'เพิ่มผู้ใช้', path: '/add-user-data' });
});

app.post("/add-user-data", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    const { employeeId, userName, password, fname, lname, email, phone, role } = req.body;
    let dbRole = (role === "ผู้จัดการ") ? "Manager" : "Staff";
    const status = "Active"; 
    const salt = crypto.randomBytes(16).toString("hex");

    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
        if (err) return res.status(500).send("เกิดข้อผิดพลาดในการเข้ารหัสรหัสผ่าน");
        const hash = derivedKey.toString("hex");
        const passwordToSave = `${salt}:${hash}`;

        db.get(`SELECT employee_id FROM Employees WHERE employee_id = ?`, [employeeId], (err, row) => {
            if (err) return res.status(500).send("Database Error");

            if (row) {
                const userSql = `INSERT INTO Users (username, password, role, employee_id, status) VALUES (?, ?, ?, ?, ?)`;
                db.run(userSql, [userName, passwordToSave, dbRole, employeeId, status], function(userErr) {
                    if (userErr) return res.status(400).send("เกิดข้อผิดพลาด: ชื่อผู้ใช้นี้ (Username) มีคนใช้แล้ว");
                    res.redirect("/manage");
                });
            } else {
                db.serialize(() => {
                    const empSql = `INSERT INTO Employees (employee_id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?)`;
                    db.run(empSql, [employeeId, fname, lname, email, phone], function(empErr) {
                        if (empErr) return res.status(400).send("เกิดข้อผิดพลาดในการสร้างข้อมูลพนักงาน");

                        const userSql = `INSERT INTO Users (username, password, role, employee_id, status) VALUES (?, ?, ?, ?, ?)`;
                        db.run(userSql, [userName, passwordToSave, dbRole, employeeId, status], function(userErr) {
                            if (userErr) return res.status(400).send("เกิดข้อผิดพลาด: ชื่อผู้ใช้นี้ (Username) มีคนใช้แล้ว");
                            res.redirect("/manage");
                        });
                    });
                });
            }
        });
    });
});

app.get('/edit-user/:id', isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    const targetUserId = req.params.id;
    const sql = `
        SELECT u.*, e.employee_id, e.first_name, e.last_name, e.email, e.phone
        FROM Users u
        LEFT JOIN Employees e ON u.employee_id = e.employee_id
        WHERE u.user_id = ?
    `;
    db.get(sql, [targetUserId], (err, row) => {
        if (err) return res.status(500).send("เกิดข้อผิดพลาดในการดึงข้อมูล");
        if (!row) return res.status(404).send("ไม่พบผู้ใช้งานนี้");

        res.render('manageEdit', { 
            title: 'แก้ไขผู้ใช้งาน', 
            path: `/update-user/${row.user_id}`, 
            user: row 
        });
    });
});

app.post('/update-user/:id', isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    const targetUserId = req.params.id;
    const { employeeId, userName, password, fname, lname, email, phone, role } = req.body;
    let dbRole = (role === "ผู้จัดการ") ? "Manager" : "Staff";

    db.serialize(() => {
        const updateEmpSql = `UPDATE Employees SET first_name = ?, last_name = ?, email = ?, phone = ? WHERE employee_id = ?`;
        db.run(updateEmpSql, [fname, lname, email, phone, employeeId], function(empErr) {
            if (empErr) return res.status(500).send("เกิดข้อผิดพลาดในการอัปเดตข้อมูลพนักงาน");

            if (password && password.trim() !== "") {
                const salt = crypto.randomBytes(16).toString("hex");
                crypto.scrypt(password, salt, 64, (err, derivedKey) => {
                    if (err) return res.status(500).send("Hashing error");
                    const hash = derivedKey.toString("hex");
                    const newPasswordToSave = `${salt}:${hash}`;

                    const updateUserSql = `UPDATE Users SET username = ?, role = ?, password = ? WHERE user_id = ?`;
                    db.run(updateUserSql, [userName, dbRole, newPasswordToSave, targetUserId], function(userErr) {
                        if (userErr) return res.status(400).send("เกิดข้อผิดพลาด: ชื่อผู้ใช้นี้ (Username) ถูกใช้งานแล้ว");
                        res.redirect('/manage');
                    });
                });
            } else {
                const updateUserSql = `UPDATE Users SET username = ?, role = ? WHERE user_id = ?`;
                db.run(updateUserSql, [userName, dbRole, targetUserId], function(userErr) {
                    if (userErr) return res.status(400).send("เกิดข้อผิดพลาด: ชื่อผู้ใช้นี้ (Username) ถูกใช้งานแล้ว");
                    res.redirect('/manage');
                });
            }
        });
    });
});

app.get("/delete-user/:userId", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    const targetUserId = req.params.userId;
    db.serialize(() => {
        db.run(`DELETE FROM Users WHERE user_id = ?`, [targetUserId]);
        res.redirect("/manage");
    });
});

app.get("/search-users", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    const id = req.query.id || '';
    const username = req.query.username || '';
    const name = req.query.name || '';
    const role = req.query.role || '';

    let sql = `
        SELECT u.username, u.role, u.status, e.employee_id, e.first_name, e.last_name
        FROM Users u
        LEFT JOIN Employees e ON u.employee_id = e.employee_id
        WHERE 1=1
    `;
    let queryParams = [];

    if (id.trim() !== '') { sql += ` AND e.employee_id LIKE ?`; queryParams.push(`%${id}%`); }
    if (username.trim() !== '') { sql += ` AND u.username LIKE ?`; queryParams.push(`%${username}%`); }
    if (name.trim() !== '') { sql += ` AND (e.first_name LIKE ? OR e.last_name LIKE ?)`; queryParams.push(`%${name}%`, `%${name}%`); }
    if (role.trim() !== '') {
        let dbRole = (role === "ผู้จัดการ") ? "Manager" : "Staff";
        sql += ` AND u.role = ?`;
        queryParams.push(dbRole);
    }
    sql += ` ORDER BY e.employee_id ASC`;

    db.all(sql, queryParams, (err, rows) => {
        if (err) return res.status(500).json({ error: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
        res.render('userSection', { users: rows }, (renderErr, htmlContent) => {
            if (renderErr) return res.status(500).json({ error: "Render error" });
            res.json({ html: htmlContent });
        });
    });
});

app.get('/toggle-ban/:userid/:status', isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    const targetUserId = req.params.userid;
    const status = req.params.status; 
    
    if (status !== 'Active' && status !== 'Inactive') {
        return res.status(400).send({ success: false, error: 'สถานะไม่ถูกต้อง' });
    }
    let newStatus = status === 'Inactive' ? 'Active' : 'Inactive'
    const sql = `UPDATE Users SET status = ? WHERE user_id = ?`;
    
    db.run(sql, [newStatus, targetUserId], function(err) {
        if (err) return res.status(500).send({ success: false, error: 'Database Error' });
        if (this.changes === 0) return res.status(404).send({ success: false, error: 'ไม่พบผู้ใช้งานนี้' });
        res.redirect('/manage')
    });
});

// --- Product Routes ---
app.get("/product", isAuthenticated, authorizeRoles(["Manager", "Staff"]), (req, res) => {
    const limit = 18; const page = 1; const offset = 0;
    const query = `
        SELECT p.product_name AS product_name, p.img_path AS img_path, p.product_id AS product_id, 
               c.category_name AS category_name, b.brand_name AS brand_name, COALESCE(SUM(l.quantity), 0) AS total_quantity
        FROM Products p 
        LEFT JOIN Categories c ON p.category_id = c.category_id 
        LEFT JOIN Brands b ON p.brand_id = b.brand_id 
        LEFT JOIN Lots l ON p.product_id = l.product_id
        GROUP BY p.product_id ORDER BY p.product_name ASC
        LIMIT ? OFFSET ?`;

    const countQuery = `SELECT COUNT(*) AS count FROM products`

    db.all(countQuery, (err, row) => {
        if (err) return res.status(500).send("Database error");
        const totalPages = Math.ceil(row[0].count / limit);
        db.all(query, [limit, offset], (err, rows) => {
            if (err) return res.status(500).send("Database error");
            res.render('showProduct', {
                data: rows, 
                currentPage: page, totalPages: totalPages
            });
        });
    });
});

app.get('/search', isAuthenticated, authorizeRoles(["Manager", "Staff"]), (req, res) => {
    const q = req.query.q || ''; const category = req.query.category || ''; const brand = req.query.brand || '';
    const limit = 18; const page = 1; const offset = 0;

    let sql = `
        SELECT p.product_name AS product_name, p.img_path AS img_path, p.product_id AS product_id, 
               c.category_name AS category_name, b.brand_name AS brand_name, COALESCE(SUM(l.quantity), 0) AS total_quantity
        FROM Products p 
        LEFT JOIN Categories c ON p.category_id = c.category_id 
        LEFT JOIN Brands b ON p.brand_id = b.brand_id 
        LEFT JOIN Lots l ON p.product_id = l.product_id
        WHERE 1=1`;

    let countQuery = `
        SELECT COUNT(*) AS count 
        FROM Products p 
        LEFT JOIN Categories c ON p.category_id = c.category_id 
        LEFT JOIN Brands b ON p.brand_id = b.brand_id
        WHERE 1=1`;

    let queryParams = [];

    if (q.trim() !== '') {
        sql += ` AND (p.product_name LIKE ? OR p.product_id LIKE ?)`;
        countQuery += ` AND (p.product_name LIKE ? OR p.product_id LIKE ?)`;
        queryParams.push(`%${q}%`, `%${q}%`);
    }
    if (category.trim() !== '') {
        sql += ` AND c.category_name = ?`; countQuery += ` AND c.category_name = ?`; queryParams.push(category);
    }
    if (brand.trim() !== '') {
        sql += ` AND b.brand_name = ?`; countQuery += ` AND b.brand_name = ?`; queryParams.push(brand);
    }

    sql += ` GROUP BY p.product_id ORDER BY p.product_name ASC`;

    db.get(countQuery, queryParams, (err, row) => {
        if (err) return res.status(500).json({ error: "Database error" });
        const totalPages = Math.ceil(row.count / limit);
        const finalSql = sql + ` LIMIT ? OFFSET ?`;
        const finalParams = [...queryParams, limit, offset]; 

        db.all(finalSql, finalParams, (err, rows) => {
            if (err) return res.status(500).json({ error: "Database error" });
            res.render('productSection', { data: rows, currentPage: page, totalPages: totalPages }, (err, html) => {
                if (err) return res.status(500).json({ error: "Render error" });
                res.json({ html: html });
            });
        });
    });
});

// Fixed typo from /add-peoduct to /add-product
app.get('/add-product', isAuthenticated, authorizeRoles(["Manager", "Staff"]), (req, res) => {
    db.get(`SELECT product_id FROM Products WHERE product_id LIKE 'B%' ORDER BY product_id DESC LIMIT 1`, [], (err, row) => {
        if (err) return res.status(500).send("เกิดข้อผิดพลาดในการสร้างรหัสสินค้า");

        let newProductId = "B000001"; 
        if (row && row.product_id) {
            const numberString = row.product_id.substring(1);
            const nextNumber = parseInt(numberString, 10) + 1;
            newProductId = "B" + String(nextNumber).padStart(6, '0');
        }

        const newProductTemplate = {
            product_id: newProductId, product_name: "", brand_name: "", category_name: "", supplier_name: "",
            net_content: "", cost_price: "", selling_price: "", fda_number: "", img_path: null
        };

        res.render('editProduct', { 
            product: newProductTemplate, title: 'เพิ่มสินค้า', url_path : "/add-product-data"
        });
    });
});

app.post("/add-product-data", isAuthenticated, authorizeRoles(["Manager", "Staff"]), uploader.single('product_image'), (req, res) => {
    const { code, name, brand, category, supplier, net_content, cost_price, selling_price, fda_no } = req.body;
    const imagePath = req.file ? req.file.filename : null;

    // 1. FIRST CHECK: Does this product name already exist?
    db.get(`SELECT product_name FROM Products WHERE product_name = ?`, [name], (checkErr, row) => {
        if (checkErr) {
            // Clean up image if DB crashes
            if (imagePath) fs.unlink(path.join(__dirname, 'public/img/product_image', imagePath), () => {});
            return res.status(500).send("เกิดข้อผิดพลาดในการตรวจสอบชื่อสินค้า");
        }

        if (row) {
            // SCENARIO A: Product name already exists!
            // Delete the image that Multer just saved so we don't waste space
            if (imagePath) {
                fs.unlink(path.join(__dirname, 'public/img/product_image', imagePath), (unlinkErr) => {
                    if (unlinkErr && unlinkErr.code !== 'ENOENT') console.error("Failed to delete orphaned image:", unlinkErr);
                });
            }
            return res.status(400).send("เกิดข้อผิดพลาด: ชื่อสินค้านี้มีอยู่ในระบบแล้ว");
        }

        // SCENARIO B: Product name is unique. Proceed with INSERT.
        const sql = `
            INSERT INTO Products (
                product_id, product_name, brand_id, category_id, supplier_id, 
                net_content, cost_price, selling_price, fda_number, img_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [code, name, brand, category, supplier, net_content, cost_price, selling_price, fda_no, imagePath];

        db.run(sql, params, function(err) {
            if (err) {
                // Also clean up the image if the insert fails (e.g., duplicate product ID)
                if (imagePath) {
                    fs.unlink(path.join(__dirname, 'public/img/product_image', imagePath), () => {});
                }

                if (err.message.includes("UNIQUE constraint failed: Products.product_id")) {
                    return res.status(400).send("เกิดข้อผิดพลาด: รหัสสินค้านี้มีอยู่ในระบบแล้ว");
                }
                return res.status(500).send("เกิดข้อผิดพลาดในการเพิ่มสินค้าใหม่");
            }
            
            // Success!
            res.redirect("/product");
        });
    });
});

app.get('/edit-product/:id', isAuthenticated, authorizeRoles(["Manager", "Staff"]), (req, res) => {
    // Note: Since this fetch is hitting your own API, passing cookies might be required if the API route is also protected.
    // The cleanest way is to just do a DB call here instead of an internal fetch, but I've kept it as requested.
    fetch(`http://localhost:${port}/api/product/${req.params.id}`, { headers: { cookie: req.headers.cookie }})
        .then(response => response.json())
        .then(data => {
            res.render('editProduct', { 
                product: data, title: 'แก้ไขสินค้า',  
                url_path : "/update-product"
            });
        })
        .catch(error => console.error('Error loading page:', error))
});

app.post("/update-product", isAuthenticated, authorizeRoles(["Manager", "Staff"]), uploader.single('product_image'), (req, res) => {
    const { code, name, brand, category, supplier, net_content, cost_price, selling_price, fda_no } = req.body;

    if (req.file) {
        const newImagePath = req.file.filename;
        db.get(`SELECT img_path FROM Products WHERE product_id = ?`, [code], (err, row) => {
            if (err) return res.status(500).send("เกิดข้อผิดพลาดในการดึงข้อมูลรูปภาพเก่า");

            if (row && row.img_path) {
                const oldImageFullPath = path.join(__dirname, 'public/img/product_image', row.img_path);
                fs.unlink(oldImageFullPath, (unlinkErr) => {
                    if (unlinkErr && unlinkErr.code !== 'ENOENT') console.error("Failed to delete old image:", unlinkErr);
                });
            }

            const sql = `
                UPDATE Products SET 
                    product_name = ?, brand_id = ?, category_id = ?, supplier_id = ?, 
                    net_content = ?, cost_price = ?, selling_price = ?, fda_number = ?, img_path = ? 
                WHERE product_id = ?
            `;
            const params = [name, brand, category, supplier, net_content, cost_price, selling_price, fda_no, newImagePath, code];

            db.run(sql, params, function(err) {
                if (err) return res.status(500).send("เกิดข้อผิดพลาดในการบันทึกข้อมูลสินค้า");
                res.redirect("/product"); 
            });
        });
    } else {
        const sql = `
            UPDATE Products SET 
                product_name = ?, brand_id = ?, category_id = ?, supplier_id = ?, 
                net_content = ?, cost_price = ?, selling_price = ?, fda_number = ?
            WHERE product_id = ?
        `;
        const params = [name, brand, category, supplier, net_content, cost_price, selling_price, fda_no, code];

        db.run(sql, params, function(err) {
            if (err) return res.status(500).send("เกิดข้อผิดพลาดในการบันทึกข้อมูลสินค้า");
            res.redirect("/product"); 
        });
    }
});

app.delete("/delete-product/:id", isAuthenticated, authorizeRoles(["Manager", "Staff"]), (req, res) => {
    const productId = req.params.id;
    db.get(`SELECT img_path FROM Products WHERE product_id = ?`, [productId], (err, row) => {
        if (err) return res.status(500).json({ error: "Database Error" });

        db.serialize(() => {
            db.run(`DELETE FROM Transactions WHERE product_id = ?`, [productId]);
            db.run(`DELETE FROM Lots WHERE product_id = ?`, [productId]);
            db.run(`DELETE FROM Products WHERE product_id = ?`, [productId], function(deleteErr) {
                if (deleteErr) return res.status(500).json({ error: "เกิดข้อผิดพลาดในการลบสินค้า" }); 

                if (row && row.img_path) {
                    const imagePath = path.join(__dirname, 'public/img/product_image', row.img_path);
                    fs.unlink(imagePath, (unlinkErr) => {
                        if (unlinkErr && unlinkErr.code !== 'ENOENT') console.error("Failed to delete image:", unlinkErr);
                    });
                }
                res.sendStatus(200); 
            });
        });
    });
});

app.get('/fetch-product/:page', isAuthenticated, authorizeRoles(["Manager", "Staff"]), (req, res) => {
    const limit = 18; const page = parseInt(req.params.page) || 1; const offset = (page - 1) * limit;
    const q = req.query.q || ''; const category = req.query.category || ''; const brand = req.query.brand || '';

    let sql = `SELECT p.product_name AS product_name, p.img_path AS img_path, p.product_id AS product_id, c.category_name AS category_name, b.brand_name AS brand_name, COALESCE(SUM(l.quantity), 0) AS total_quantity
               FROM Products p LEFT JOIN Categories c ON p.category_id = c.category_id LEFT JOIN Brands b ON p.brand_id = b.brand_id LEFT JOIN Lots l ON p.product_id = l.product_id WHERE 1=1`;
    let countQuery = `SELECT COUNT(*) AS count FROM Products p LEFT JOIN Categories c ON p.category_id = c.category_id LEFT JOIN Brands b ON p.brand_id = b.brand_id WHERE 1=1`;
    let queryParams = [];

    if (q.trim() !== '') { sql += ` AND (p.product_name LIKE ? OR p.product_id LIKE ?)`; countQuery += ` AND (p.product_name LIKE ? OR p.product_id LIKE ?)`; queryParams.push(`%${q}%`, `%${q}%`); }
    if (category.trim() !== '') { sql += ` AND c.category_name = ?`; countQuery += ` AND c.category_name = ?`; queryParams.push(category); }
    if (brand.trim() !== '') { sql += ` AND b.brand_name = ?`; countQuery += ` AND b.brand_name = ?`; queryParams.push(brand); }

    sql += ` GROUP BY p.product_id ORDER BY p.product_name ASC`;

    db.get(countQuery, queryParams, (err, row) => {
        if (err) return res.status(500).json({ error: "Database error" });
        const totalPages = Math.ceil(row.count / limit);
        const finalSql = sql + ` LIMIT ? OFFSET ?`;
        const finalParams = [...queryParams, limit, offset];

        db.all(finalSql, finalParams, (err, rows) => {
            if (err) return res.status(500).json({ error: "Database error" });
            res.render('productSection', { data: rows, currentPage: page, totalPages: totalPages }, (err, html) => {
                if (err) return res.status(500).json({ error: "Render error" });
                res.json({ html: html });
            });
        });
    });
});

app.get("/api/product/:id", isAuthenticated, authorizeRoles(["Manager", "Staff"]), (req, res) => {
    const productId = req.params.id;
    const query = `
        SELECT p.*, c.category_name, b.brand_name, s.supplier_name, COALESCE(SUM(l.quantity), 0) AS total_quantity
        FROM Products p
        LEFT JOIN Categories c ON p.category_id = c.category_id
        LEFT JOIN Brands b ON p.brand_id = b.brand_id
        LEFT JOIN Suppliers s ON p.supplier_id = s.supplier_id
        LEFT JOIN Lots l ON p.product_id = l.product_id
        WHERE p.product_id = ?
        GROUP BY p.product_id
    `;
    db.get(query, [productId], (err, row) => {
        if (err) return res.status(500).json({ error: "Database error" });
        if (!row) return res.status(404).json({ error: "Product not found" });
        res.json(row);
    });
});


app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});