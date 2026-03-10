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
const { error } = require("console");

const app = express();

app.use(cookieParser());
app.use(session({
    secret: 'secretWarehouseKey123456789', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 } 
}));


app.use(express.static('public'));

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


const dbPath = path.join(__dirname, 'Warehouse.db');
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
    db.all(`SELECT * FROM Branches ORDER BY branch_name`, [], (err, branches) => {
        if (!err) app.locals.branches  = branches;
    });
}




function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        
        res.locals.user = req.session.user; 
        return next();
    } else {
        
        res.redirect("/?error=notfound");
    }
}

function authorizeRoles(allowedRoles) {
    return (req, res, next) => {
        
        if (!req.session || !req.session.user) {
            return res.redirect("/?error=notfound");
        }

        
        const userRole = req.session.user.role; 

        if (allowedRoles.includes(userRole)) {
            
            return next(); 
        } else {
            
            
            return res.status(403).send(`
                <div style="text-align:center; margin-top: 50px; font-family: sans-serif;">
                    <h1>🛑 403 Forbidden</h1>
                    <p>ขออภัย คุณไม่มีสิทธิ์เข้าถึงหน้านี้</p>
                    <a href="/dashboard">กลับไปหน้าหลัก</a>
                </div>
            `);
        }
    }
}




app.get("/", (req, res) => {
    
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

    const sql = `SELECT Users.username, Users.password, Users.employee_id, Users.status, Users.role, Employees.first_name, Employees.last_name
        FROM Users 
        INNER JOIN Employees ON Users.employee_id = Employees.employee_id 
        WHERE Users.username = ?`;

    db.get(sql, [username], (err, row) => {
        if (err) return res.status(500).send(err.message);
        if (!row) return res.redirect("/?error=notfound");
        if (row.status === "Inactive") return res.redirect("/?error=inactive");

        const savedPassword = row.password;
        const [salt, originalHash] = savedPassword.split(":");

        crypto.scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) return res.status(500).send("Hashing error");

            const attemptHash = derivedKey.toString("hex");

            if (attemptHash === originalHash) {
                
                req.session.user = {
                    username: row.username,
                    role: row.role,
                    emp_id: row.employee_id,
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

app.get("/receive", isAuthenticated, authorizeRoles([ "Staff", "StaffBranch"]), (req, res) => { 
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
            res.render('receive_stock', {
                data: rows, 
                currentPage: page, totalPages: totalPages,
                branchId: ''
            });
        });
    });
});

app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
            return res.status(500).send("Error logging out.");
        }
        
        res.clearCookie('connect.sid');
        res.redirect("/");
    });
});






app.get("/dashboard", isAuthenticated, (req, res) => {
    const sql = `
        SELECT
            -- 1. จำนวนสินค้าทั้งหมด
            (SELECT COUNT(*) FROM Products) AS total_products,
            
            -- ดึงเวลาที่มีการทำรายการล่าสุด
            (SELECT transaction_date FROM Transactions ORDER BY transaction_date DESC LIMIT 1) AS last_update,
            
            -- 2. สต็อกคงเหลือ (รวมจำนวนสินค้าในทุกล็อต)
            (SELECT COALESCE(SUM(quantity), 0) FROM Lots) AS total_stock,
            
            -- สต็อกที่เพิ่ม/ลด ในวันนี้ (เทียบจากเมื่อวาน)
            (SELECT COALESCE(SUM(
                CASE 
                    WHEN transaction_type = 'รับสินค้า' THEN change_amount 
                    WHEN transaction_type = 'จ่ายสินค้า' THEN -change_amount
                    ELSE 0 
                END
            ), 0) FROM Transactions WHERE date(transaction_date) = date('now', 'localtime')) AS daily_change,
            
            -- 3. สินค้าใกล้หมดอายุ (ภายใน 30 วัน)
            (SELECT COUNT(*) FROM Lots 
             WHERE quantity > 0 AND exp_date IS NOT NULL 
             AND CAST(julianday(exp_date) - julianday(date('now', 'localtime')) AS INTEGER) BETWEEN 0 AND 30
            ) AS expiring_soon,
            
            -- 4. สินค้าหมดอายุแล้ว (วันหมดอายุน้อยกว่าวันนี้)
            (SELECT COUNT(*) FROM Lots 
             WHERE quantity > 0 AND exp_date IS NOT NULL 
             AND CAST(julianday(exp_date) - julianday(date('now', 'localtime')) AS INTEGER) < 0
            ) AS expired
    `;

    db.get(sql, [], (err, row) => {
        if (err) {
            console.error("Dashboard Error:", err.message);
            return res.status(500).send("เกิดข้อผิดพลาดในการโหลดข้อมูล Dashboard");
        }

        
        let formattedLastUpdate = "ยังไม่มีข้อมูล";
        if (row.last_update) {
            const d = new Date(row.last_update);
            formattedLastUpdate = d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
        }

        
        const dashData = {
            totalProducts: row.total_products || 0,
            lastUpdate: formattedLastUpdate,
            totalStock: row.total_stock || 0,
            dailyChange: row.daily_change || 0,
            expiringSoon: row.expiring_soon || 0,
            expired: row.expired || 0
        };

        
        res.render("mainpage", { dashData: dashData });
    });
});
app.get("/history", isAuthenticated, authorizeRoles(["Manager", "Staff"]), (req, res) => {
    const sql = `
        SELECT 
            t.*, 
            p.product_name,
            e.first_name, 
            e.last_name
        FROM Transactions t
        LEFT JOIN Products p ON t.product_id = p.product_id
        LEFT JOIN Employees e ON t.employee_id = e.employee_id
        ORDER BY t.transaction_date DESC
    `;

    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).send("เกิดข้อผิดพลาดในการดึงข้อมูลประวัติการทำรายการ");
        }

        
        res.render("history", { transactions: rows });
    });
});
app.get("/report", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    res.render("report")
});
app.get("/createReport/:type", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    res.render("generateReport", {type:req.params.type})
});

app.get("/generate-report", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    
    const { reportType, startDate, endDate, productName, brandId, sortBy, expireDays, transType, employee_name, productLeft,lotCode } = req.query;

    let sql = "";
    let queryParams = [];

    
    
    
    if (reportType === 'movement') {
    
    
    sql = `
        SELECT 
            t.transaction_date, 
            t.transaction_type,
            b.branch_name,
            p.product_id, 
            p.product_name, 
            t.change_amount, 
            e.first_name || ' ' || e.last_name AS employee_name
        FROM Transactions t
        LEFT JOIN Products p ON t.product_id = p.product_id
        LEFT JOIN Employees e ON t.employee_id = e.employee_id
        LEFT JOIN Branches b ON t.destination_branch = b.branch_id
        WHERE 1=1
    `;

    
    if (startDate) { 
        sql += ` AND t.transaction_date >= ?`; 
        queryParams.push(`${startDate} 00:00:00`); 
    }
    if (endDate) { 
        sql += ` AND t.transaction_date <= ?`; 
        queryParams.push(`${endDate} 23:59:59`); 
    }
    
    
    if (productName) { 
        sql += ` AND (p.product_id LIKE ? OR p.product_name LIKE ?)`; 
        queryParams.push(`%${productName}%`, `%${productName}%`); 
    }

    
    if (transType) {
        sql += ` AND t.transaction_type = ?`;
        queryParams.push(transType);
    }

    
    if (employee_name) {
        sql += ` AND Concat(e.first_name, ' ', e.last_name)LIKE ?`;
        queryParams.push(`%${employee_name.trim()}%`);
    }

    if (sortBy === 'date_asc') {
        sql += ` ORDER BY t.transaction_date ASC`;
    } else if (sortBy === 'type_desc') {
        sql += ` ORDER BY t.transaction_type Desc, t.transaction_date DESC`;
    } else if (sortBy === 'type_asc') {
        sql += ` ORDER BY t.transaction_type ASC, t.transaction_date DESC`;
    }else if (sortBy === 'product_name') {
        sql += ` ORDER BY p.product_name ASC, t.transaction_date DESC`;
    } else if (sortBy === 'amount_desc') {
        
        sql += ` ORDER BY t.change_amount DESC`; 
    } else if (sortBy === 'amount_asc') {
        sql += ` ORDER BY t.change_amount ASC`;
    } else {
        
        sql += ` ORDER BY t.transaction_date DESC`;
    }
    
    
    
    } else if (reportType === 'stock') {
        sql = `
        SELECT 
            p.product_id, 
            p.product_name, 
            c.category_name,
            b.brand_name,
            COALESCE(SUM(l.quantity), 0) AS total_quantity, 
            p.cost_price,
            (COALESCE(SUM(l.quantity), 0) * p.cost_price) AS total_value
        FROM Products p
        LEFT JOIN Categories c ON p.category_id = c.category_id
        LEFT JOIN Brands b ON p.brand_id = b.brand_id
        LEFT JOIN Lots l ON p.product_id = l.product_id
        WHERE 1=1
    `;
    
    if (productName) {
        sql += ` AND (p.product_name LIKE ? OR p.product_id LIKE ?)`;
        queryParams.push(`%${productName}%`, `%${productName}%`);
    }
    if (brandId) {
        sql += ` AND p.brand_id = ?`;
        queryParams.push(brandId);
    }

    
    
    sql += ` GROUP BY p.product_id `;

    if (productLeft) {
        sql += ` HAVING total_quantity <= ?`;
        queryParams.push(Number(productLeft));
    }

    
    if (sortBy === 'product_name') {
        sql += ` ORDER BY p.product_name ASC`;
    } else if (sortBy === 'brand_name') {
        sql += ` ORDER BY b.brand_name ASC`;
    } else if (sortBy === 'category_name') {
        sql += ` ORDER BY c.category_name ASC`;
    } else if (sortBy === 'total_quantity_asc') {
        sql += ` ORDER BY total_quantity ASC`;
    } else if (sortBy === 'total_quantity_desc') {
        sql += ` ORDER BY total_quantity DESC`;
    } else {
        
        sql += ` ORDER BY p.product_id ASC`;
    }
    
    
    
    } else if (reportType === 'expire') {
        const days = expireDays || 30;
        sql = `
            SELECT 
                p.product_id, 
                p.product_name,
                b.brand_name,
                l.lot_batch_code,
                l.quantity, 
                l.exp_date,
                CAST(julianday(l.exp_date) - julianday(date('now', 'localtime')) AS INTEGER) AS days_remaining
            FROM Lots l
            LEFT JOIN Products p ON l.product_id = p.product_id
            LEFT JOIN Brands b ON p.brand_id = b.brand_id
            WHERE l.quantity > 0 
              AND l.exp_date IS NOT NULL
              AND CAST(julianday(l.exp_date) - julianday(date('now', 'localtime')) AS INTEGER) <= ?
        `;
        queryParams.push(days);

        if (productName) {
            sql += ` AND (p.product_name LIKE ? OR p.product_id LIKE ?)`;
            queryParams.push(`%${productName}%`, `%${productName}%`);
        }
        
        if (brandId) {
            sql += ` AND p.brand_id = ?`;
            queryParams.push(brandId);
        }
        
        if (lotCode) {
            sql += ` AND l.lot_batch_code LIKE ?`;
            queryParams.push(`%${lotCode}%`);
        }

        
        if (sortBy === 'product_name') {
            sql += ` ORDER BY p.product_name ASC`;
        } else if (sortBy === 'brand_name') {
            sql += ` ORDER BY b.brand_name ASC`;
        } else if (sortBy === 'exp_date_desc') {
            sql += ` ORDER BY l.exp_date DESC`;
        } else if (sortBy === 'exp_date_asc') {
            sql += ` ORDER BY l.exp_date ASC`;
        } else {
            sql += ` ORDER BY p.product_id ASC`;
        }

    } else {
        
        return res.status(400).json({ error: "ประเภทรายงานไม่ถูกต้อง" });
    }

    
    
    
    db.all(sql, queryParams, (err, rows) => {
        if (err) {
            console.error("Report Database Error:", err.message); 
            return res.status(500).json({ error: "เกิดข้อผิดพลาดในการดึงข้อมูลรายงาน" });
        }

        
        if (rows.length === 0) {
            return res.status(404).json({ error: "ไม่พบข้อมูลในช่วงเวลาหรือเงื่อนไขที่เลือก" });
        }

        
        res.json(rows);
    });
});

app.get("/export-report", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    
    const { reportType, startDate, endDate, productName, brandId, sortBy, expireDays, type, employee_name, productLeft, lotCode } = req.query;
    let queryParams = [];
    let csvHeader = "";

    if (reportType === 'movement') {
        
        sql = `
        SELECT 
            t.transaction_date, 
            t.transaction_type,
            b.branch_name,
            p.product_id, 
            p.product_name, 
            t.change_amount, 
            e.first_name || ' ' || e.last_name AS employee_name
        FROM Transactions t
        LEFT JOIN Products p ON t.product_id = p.product_id
        LEFT JOIN Employees e ON t.employee_id = e.employee_id
        LEFT JOIN Branches b ON t.destination_branch = b.branch_id
        WHERE 1=1
    `;

    
    if (startDate) { 
        sql += ` AND t.transaction_date >= ?`; 
        queryParams.push(`${startDate} 00:00:00`); 
    }
    if (endDate) { 
        sql += ` AND t.transaction_date <= ?`; 
        queryParams.push(`${endDate} 23:59:59`); 
    }
    
    
    if (productName) { 
        sql += ` AND (p.product_id LIKE ? OR p.product_name LIKE ?)`; 
        queryParams.push(`%${productName}%`, `%${productName}%`); 
    }

    
    if (type && type.trim() !== '') {
        sql += ` AND t.transaction_type = ?`;
        queryParams.push(type);
    }

    
    if (employee_name) {
        sql += ` AND Concat(e.first_name, ' ', e.last_name)LIKE ?`;
        queryParams.push(`%${employee_name.trim()}%`);
    }

    if (sortBy === 'date_asc') {
        sql += ` ORDER BY t.transaction_date ASC`;
    } else if (sortBy === 'type_desc') {
        sql += ` ORDER BY t.transaction_type Desc, t.transaction_date DESC`;
    } else if (sortBy === 'type_asc') {
        sql += ` ORDER BY t.transaction_type ASC, t.transaction_date DESC`;
    } else if (sortBy === 'product_name') {
        sql += ` ORDER BY p.product_name ASC, t.transaction_date DESC`;
    } else if (sortBy === 'amount_desc') {
        
        sql += ` ORDER BY t.change_amount DESC`; 
    } else if (sortBy === 'amount_asc') {
        sql += ` ORDER BY t.change_amount ASC`;
    } else {
        
        sql += ` ORDER BY t.transaction_date DESC`;
    }

    
    csvHeader = "วันที่,รหัสสินค้า,ชื่อสินค้า,ประเภทรายการ,จำนวน,ผู้ทำรายการ\n";
    

    
    
    
    } else if (reportType === 'stock') {
        
        sql = `
            SELECT 
                p.product_id, 
                p.product_name, 
                c.category_name,
                b.brand_name,
                COALESCE(SUM(l.quantity), 0) AS total_quantity, 
                p.cost_price, 
                (COALESCE(SUM(l.quantity), 0) * p.cost_price) AS total_value
            FROM Products p
            LEFT JOIN Categories c ON p.category_id = c.category_id
            LEFT JOIN Brands b ON p.brand_id = b.brand_id
            LEFT JOIN Lots l ON p.product_id = l.product_id
            WHERE 1=1
        `;
        
        if (productName) {
            sql += ` AND (p.product_name LIKE ? OR p.product_id LIKE ?)`;
            queryParams.push(`%${productName}%`, `%${productName}%`);
        }
        if (brandId) {
            sql += ` AND p.brand_id = ?`;
            queryParams.push(brandId);
        }
        
        sql += ` GROUP BY p.product_id `;

        if (productLeft) {
        sql += ` HAVING total_quantity <= ?`;
        queryParams.push(Number(productLeft));
    }

        
        if (sortBy === 'product_name') {
            sql += ` ORDER BY p.product_name ASC`;
        } else if (sortBy === 'brand_name') {
            sql += ` ORDER BY b.brand_name ASC`;
        } else if (sortBy === 'category_name') {
            sql += ` ORDER BY c.category_name ASC`;
        } else if (sortBy === 'total_quantity_asc') {
            sql += ` ORDER BY total_quantity ASC`;
        } else if (sortBy === 'total_quantity_desc') {
            sql += ` ORDER BY total_quantity DESC`;
        } else {
            sql += ` ORDER BY p.product_id ASC`;
        }
        
        csvHeader = "รหัสสินค้า,ชื่อสินค้า,แบรนด์,หมวดหมู่,คงเหลือ (ชิ้น),ต้นทุน/ชิ้น,มูลค่ารวม\n";

    } else if (reportType === 'expire') {
        
        const days = expireDays || 30;
        sql = `
            SELECT 
                p.product_id, 
                p.product_name,
                b.brand_name,
                l.lot_batch_code,
                l.quantity, 
                l.exp_date,
                CAST(julianday(l.exp_date) - julianday(date('now', 'localtime')) AS INTEGER) AS days_remaining
            FROM Lots l
            LEFT JOIN Products p ON l.product_id = p.product_id
            LEFT JOIN Brands b ON p.brand_id = b.brand_id
            WHERE l.quantity > 0 
              AND l.exp_date IS NOT NULL
              AND CAST(julianday(l.exp_date) - julianday(date('now', 'localtime')) AS INTEGER) <= ?
        `;
        queryParams.push(days);

        if (productName) {
            sql += ` AND (p.product_name LIKE ? OR p.product_id LIKE ?)`;
            queryParams.push(`%${productName}%`, `%${productName}%`);
        }
        
        if (brandId) {
            sql += ` AND p.brand_id = ?`;
            queryParams.push(brandId);
        }
        
        if (lotCode) {
            sql += ` AND l.lot_batch_code LIKE ?`;
            queryParams.push(`%${lotCode}%`);
        }

        
        if (sortBy === 'product_name') {
            sql += ` ORDER BY p.product_name ASC`;
        } else if (sortBy === 'brand_name') {
            sql += ` ORDER BY b.brand_name ASC`;
        } else if (sortBy === 'exp_date_desc') {
            sql += ` ORDER BY l.exp_date DESC`;
        } else if (sortBy === 'exp_date_asc') {
            sql += ` ORDER BY l.exp_date ASC`;
        } else {
            sql += ` ORDER BY p.product_id ASC`;
        }
        
        csvHeader = "รหัสสินค้า,ชื่อสินค้า,แบรนด์,รหัสล็อต,จำนวน,วันหมดอายุ,เหลือเวลา (วัน)\n";
    }

    
    db.all(sql, queryParams, (err, rows) => {
        if (err) {
            console.error("Export DB Error:", err.message);
            return res.status(500).send("เกิดข้อผิดพลาดจากฐานข้อมูล: " + err.message);
        }
        
        if (!rows || rows.length === 0) {
            return res.status(404).send("ไม่พบข้อมูลที่จะ Export");
        }

        let csvContent = csvHeader;
        
        rows.forEach(row => {
            if (reportType === 'movement') {
                csvContent += `"${row.transaction_date}","${row.product_id}","${row.product_name}","${row.transaction_type}${row.branch_name ? ` (${row.branch_name})` : ''}","${row.change_amount}","${row.employee_name}"\n`;
            } else if (reportType === 'stock') {
                csvContent += `"${row.product_id}","${row.product_name}","${row.brand_name}","${row.category_name}","${row.total_quantity}","${row.cost_price}","${row.total_value}"\n`;
            } else if (reportType === 'expire') {
                csvContent += `"${row.product_id}","${row.product_name}","${row.brand_name}","${row.lot_id}","${row.quantity}","${row.exp_date}","${row.days_remaining}"\n`;
            }
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="report_${reportType}.csv"`);
        res.send('\uFEFF' + csvContent);
    });
});


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

app.get("/api/employee/:id", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    const empId = req.params.id;
    db.get(`SELECT * FROM Employees WHERE employee_id = ?`, [empId], (err, row) => {
        if (err) return res.status(500).json({ error: "เกิดข้อผิดพลาดในฐานข้อมูล กรุณาลองใหม่อีกครั้ง" });
        if (!row) return res.status(404).json({ error: "ไม่พบรหัสพนักงานนี้ในระบบ" });
        res.json(row);
    });
});

app.get("/add-user", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    const errorMap = {
        duplicate_username: "ชื่อผู้ใช้นี้มีคนใช้แล้ว กรุณาเลือกชื่อใหม่",
        db_error: "เกิดข้อผิดพลาดในฐานข้อมูล กรุณาลองใหม่อีกครั้ง",
        duplicate_employee: "รหัสพนักงานนี้มีบัญชีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น",
        password_error: "รหัสผ่านไม่ถูกต้องกรุณาลองใหม่อีกครั้ง",
    };
    const error = errorMap[req.query.error] || null;
    res.render("manageEdit", { user: null, title: 'เพิ่มผู้ใช้', path: '/add-user-data', error });
});

app.post("/add-user-data", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    const { employeeId, userName, password, cPassword, fname, lname, email, phone, role } = req.body;
    const status = "Active"; 
    const salt = crypto.randomBytes(16).toString("hex");

    if (cPassword.trim() != '' &&  cPassword.trim() === password.trim()){
    crypto.scrypt(password.trim(), salt, 64, (err, derivedKey) => {
        if (err) return res.redirect("/add-user?error=db_error");
        const hash = derivedKey.toString("hex");
        const passwordToSave = `${salt}:${hash}`;

        db.get(`SELECT employee_id FROM Employees WHERE employee_id = ?`, [employeeId], (err, row) => {
            if (err) return res.redirect("/add-user?error=db_error");

            if (row) {
                
                return res.redirect("/add-user?error=duplicate_employee");
            } else {
                db.serialize(() => {
                    const empSql = `INSERT INTO Employees (employee_id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?)`;
                    db.run(empSql, [employeeId, fname, lname, email, phone], function(empErr) {
                        if (empErr) {
                            
                            if (empErr.message.includes("UNIQUE constraint failed: Employees.employee_id")) {
                                return res.redirect("/add-user?error=duplicate_employee");
                            }
                            return res.redirect("/add-user?error=db_error");
                        }

                        const userSql = `INSERT INTO Users (username, password, role, employee_id, status) VALUES (?, ?, ?, ?, ?)`;
                        db.run(userSql, [userName, passwordToSave, role, employeeId, status], function(userErr) {
                            if (userErr) {
                                if (userErr.message.includes("UNIQUE constraint failed: Users.employee_id")) {
                                    return res.redirect("/add-user?error=duplicate_employee");
                                }
                                return res.redirect("/add-user?error=duplicate_username");
                            }
                            res.redirect("/manage");
                        });
                    });
                });
            }
        });
    });}
    else{
        return res.redirect("/add-user?error=password_error");
    }
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

        const errorMap = {
            duplicate_username: "ชื่อผู้ใช้นี้มีคนใช้แล้ว กรุณาเลือกชื่อใหม่",
        db_error: "เกิดข้อผิดพลาดในฐานข้อมูล กรุณาลองใหม่อีกครั้ง",
        duplicate_employee: "รหัสพนักงานนี้มีบัญชีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น",
        password_error: "รหัสผ่านไม่ถูกต้องกรุณาลองใหม่อีกครั้ง",
        };
        const error = errorMap[req.query.error] || null;

        res.render('manageEdit', { 
            title: 'แก้ไขผู้ใช้งาน', 
            path: `/update-user/${row.user_id}`, 
            user: row,
            error
        });
    });
});

app.post('/update-user/:id', isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    const targetUserId = req.params.id;
    const { employeeId, userName, password, cPassword, email, phone, role } = req.body;

    const handleUserUpdate = (passwordToSave) => {
        const updateEmpSql = `UPDATE Employees SET email = ?, phone = ? WHERE employee_id = ?`;
        db.run(updateEmpSql, [email, phone, employeeId], function(empErr) {
            if (empErr) {
                
                if (empErr.message.includes("UNIQUE constraint failed: Employees.employee_id")) {
                    return res.redirect(`/edit-user/${targetUserId}?error=duplicate_employee`);
                }
                return res.redirect(`/edit-user/${targetUserId}?error=db_error`);
            }

            
            if (passwordToSave) {
                const sql = `UPDATE Users SET username = ?, role = ?, password = ? WHERE user_id = ?`;
                db.run(sql, [userName, role, passwordToSave, targetUserId], function(err) {
                    if (err) return res.redirect(`/edit-user/${targetUserId}?error=duplicate_username`);
                    res.redirect('/manage');
                });
            } else {
                const sql = `UPDATE Users SET username = ?, role = ? WHERE user_id = ?`;
                db.run(sql, [userName, role, targetUserId], function(err) {
                    if (err) return res.redirect(`/edit-user/${targetUserId}?error=duplicate_username`);
                    res.redirect('/manage');
                });
            }
        });
    };

    if (password && password.trim() !== "") {
        if (cPassword.trim() === password.trim()) {
            const salt = crypto.randomBytes(16).toString("hex");
            crypto.scrypt(password, salt, 64, (err, derivedKey) => {
                if (err) return res.redirect(`/edit-user/${targetUserId}?error=db_error`);
                const hash = derivedKey.toString("hex");
                handleUserUpdate(`${salt}:${hash}`);
            });
        } else {
            return res.redirect(`/edit-user/${targetUserId}?error=password_error`);
        }
    } else {
        handleUserUpdate(null);
    }
});

app.get("/delete-user/:userId", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    const targetUserId = req.params.userId;
    db.serialize(() => {
        db.run(`DELETE FROM Users WHERE user_id = ?`, [targetUserId]);
        res.redirect("/manage");
    });
});

app.get("/search/users", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    const id = req.query.id || '';
    const username = req.query.username || '';
    const name = req.query.name || '';
    const role = req.query.role || '';

    let sql = `
        SELECT u.user_id, u.username, u.role, u.status, e.employee_id, e.first_name, e.last_name
        FROM Users u
        LEFT JOIN Employees e ON u.employee_id = e.employee_id
        WHERE 1=1
    `;
    let queryParams = [];

    if (id.trim() !== '') { sql += ` AND e.employee_id LIKE ?`; queryParams.push(`%${id}%`); }
    if (username.trim() !== '') { sql += ` AND u.username LIKE ?`; queryParams.push(`%${username}%`); }
    if (name.trim() !== '') { sql += ` AND concat(e.first_name, " ", e.last_name) LIKE ?`; queryParams.push(`%${name}%`); }
    if (role.trim() !== '') {
        sql += ` AND u.role = ?`;
        queryParams.push(role);
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

app.get("/search/transactions", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    
    const productNameSearch = req.query.productName || ''; 
    const startDateSearch = req.query.start_date || ''; 
    const endDateSearch = req.query.end_date || ''; 
    const typeSearch = req.query.type || ''; 
    const employeeNameSearch = req.query.employee_name || '';

    let sql = `
        SELECT 
            t.*, p.product_name, e.first_name, e.last_name
        FROM Transactions t
        LEFT JOIN Products p ON t.product_id = p.product_id
        LEFT JOIN Employees e ON t.employee_id = e.employee_id
        WHERE 1=1
    `;
    
    let queryParams = [];

    
    if (productNameSearch.trim() !== '') {
        sql += ` AND (p.product_name LIKE ? OR t.product_id LIKE ?)`;
        queryParams.push(`%${productNameSearch}%`, `%${productNameSearch}%`);
    }

    
    if (typeSearch.trim() !== '') {
        sql += ` AND t.transaction_type = ?`; 
        queryParams.push(typeSearch);
    }

    
    if (startDateSearch.trim() !== '') {
        sql += ` AND t.transaction_date >= ?`;
        queryParams.push(`${startDateSearch} 00:00:00`); 
    }

    
    if (endDateSearch.trim() !== '') {
        sql += ` AND t.transaction_date <= ?`;
        queryParams.push(`${endDateSearch} 23:59:59`); 
    }

    
    if (employeeNameSearch.trim() !== '') {
        sql += ` AND Concat(e.first_name, ' ', e.last_name)LIKE ?`;
        queryParams.push(`%${employeeNameSearch.trim()}%`);
    }

    
    sql += ` ORDER BY t.transaction_date DESC`;

    db.all(sql, queryParams, (err, rows) => {
        if (err) {
            console.error("Database Error:", err.message); 
            return res.status(500).json({ error: "เกิดข้อผิดพลาดในการค้นหาประวัติ" });
        }

        res.render('transactionSection', { transactions: rows }, (renderErr, htmlContent) => {
            if (renderErr) {
                console.error("Render Error:", renderErr.message); 
                return res.status(500).json({ error: "Render error" });
            }
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


app.get("/product", isAuthenticated, authorizeRoles(["Manager", "Staff"]), (req, res) => {
    const searchTerm = req.query.search || "";
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
                currentPage: page, totalPages: totalPages,
                searchTerm: searchTerm,
                branchId: ''
            });
        });
    });
});

app.get('/search/:ejsName', isAuthenticated, authorizeRoles(["Manager", "Staff"]), (req, res) => {
    const q = req.query.q || ''; const category = req.query.category || ''; const brand = req.query.brand || ''; const branchId = req.query.branch_id || '';
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
            
            
            res.render(req.params.ejsName, {
                ejsName: req.params.ejsName, 
                data: rows, 
                currentPage: page, 
                totalPages: totalPages,
                branchId: branchId  
            }, (err, html) => {
                if (err) return res.status(500).json({ error: "Render error" });
                res.json({ html: html });
            });
        });
    });
});


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
            product: newProductTemplate, title: 'เพิ่มสินค้า', url_path : "/add-product-data",
            brands: app.locals.brands || [],
            categories: app.locals.categories || [],
            suppliers: app.locals.suppliers || []
        });
    });
});

app.post("/add-product-data", isAuthenticated, authorizeRoles(["Manager", "Staff"]), uploader.single('product_image'), (req, res) => {
    const { code, name, brand, category, supplier, net_content, cost_price, selling_price, fda_no } = req.body;
    const imagePath = req.file ? req.file.filename : null;

    
    db.get(`SELECT product_name FROM Products WHERE product_name = ?`, [name], (checkErr, row) => {
        if (checkErr) {
            
            if (imagePath) fs.unlink(path.join(__dirname, 'public/img/product_image', imagePath), () => {});
            return res.status(500).send("เกิดข้อผิดพลาดในการตรวจสอบชื่อสินค้า");
        }

        if (row) {
            
            
            if (imagePath) {
                fs.unlink(path.join(__dirname, 'public/img/product_image', imagePath), (unlinkErr) => {
                    if (unlinkErr && unlinkErr.code !== 'ENOENT') console.error("Failed to delete orphaned image:", unlinkErr);
                });
            }
            return res.status(400).send("เกิดข้อผิดพลาด: ชื่อสินค้านี้มีอยู่ในระบบแล้ว");
        }

        
        const sql = `
            INSERT INTO Products (
                product_id, product_name, brand_id, category_id, supplier_id, 
                net_content, cost_price, selling_price, fda_number, img_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [code, name, brand, category, supplier, net_content, cost_price, selling_price, fda_no, imagePath];

        db.run(sql, params, function(err) {
            if (err) {
                
                if (imagePath) {
                    fs.unlink(path.join(__dirname, 'public/img/product_image', imagePath), () => {});
                }

                if (err.message.includes("UNIQUE constraint failed: Products.product_id")) {
                    return res.status(400).send("เกิดข้อผิดพลาด: รหัสสินค้านี้มีอยู่ในระบบแล้ว");
                }
                return res.status(500).send("เกิดข้อผิดพลาดในการเพิ่มสินค้าใหม่");
            }
            
            
            res.redirect("/product");
        });
    });
});

app.get('/edit-product/:id', isAuthenticated, authorizeRoles(["Manager", "Staff"]), (req, res) => {
    
    
    fetch(`http://localhost:${port}/api/product/${req.params.id}`, { headers: { cookie: req.headers.cookie }})
        .then(response => response.json())
        .then(data => {
            res.render('editProduct', { 
                product: data, title: 'แก้ไขสินค้า',  
                url_path : "/update-product",
                brands: app.locals.brands || [],
                categories: app.locals.categories || [],
                suppliers: app.locals.suppliers || []
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

app.get('/receiveForm/:id', isAuthenticated,authorizeRoles([ "Staff", "StaffBranch"]), (req, res) => {
    const errorMap = {
        mfg_equal: "วันผลิตกับวันหมดอายุต้องไม่เป็นวันเดียวกัน",
        mfg_greater: "วันผลิตต้องไม่มากกว่าวันหมดอายุ",
        success: "success",
    };
    const error = errorMap[req.query.error] || null;
    fetch(`http://localhost:${port}/api/product/${req.params.id}`, { headers: { cookie: req.headers.cookie }})
        .then(response => response.json())
        .then(data => {
            res.render('receive_form', {product: data, error : error});
        })
        .catch(error => console.error('Error loading page:', error))
});

app.post('/save-stock/:id', isAuthenticated, authorizeRoles([ "Staff", "StaffBranch"]), (req, res) => {

    const {quantity, lot_number, mfd_date, exp_date, remark } = req.body;

    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const transaction_date = (new Date(now - tzOffset)).toISOString().slice(0, 19).replace('T', ' ');

    let note = remark || ''; 
    if (mfd_date < exp_date) {
        const mfd = new Date(mfd_date);
        const diffTime = Math.abs(now - mfd);
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        note = `ได้รับสินค้า ${diffDays} วัน หลังจากวันผลิต`;
    }else if (mfd_date > exp_date){
        return res.redirect(`/receiveForm/${req.params.id}?error=mfg_greater`)
    }else if (mfd_date == exp_date){
        return res.redirect(`/receiveForm/${req.params.id}?error=mfg_equal`)
    }

    const transaction_type = 'รับสินค้า';

    
    const sqlInsertLot = `INSERT INTO lots (product_id, quantity, lot_batch_code, mfg_date, exp_date) VALUES (?, ?, ?, ?, ?)`;
    
    
    const sqlInsertTransaction = `INSERT INTO Transactions (product_id, employee_id, change_amount, transaction_type, transaction_date, note) VALUES (?, ?, ?, ?, ?, ?)`;

    
    
    
    db.run(sqlInsertLot, [req.params.id, quantity, lot_number, mfd_date, exp_date], function(err) {
        if (err) {
            console.error("Error inserting lot:", err.message);
            return res.status(500).send("เกิดข้อผิดพลาดในการบันทึก Lot: " + err.message);
        }

        
        db.run(sqlInsertTransaction, [req.params.id, req.session.user.emp_id, quantity, transaction_type, transaction_date, note], function(err2) {
            if (err2) {
                console.error("Error inserting transaction:", err2.message);
                
                return res.status(500).send("เกิดข้อผิดพลาดในการบันทึก Transaction: " + err2.message);
            }

            
            res.redirect(`/receiveForm/${req.params.id}?error=success`);
        });
    });
});

app.get('/withdraw',isAuthenticated, authorizeRoles([ "Staff", "StaffBranch"]), (req, res) => {
    res.render('withdraw_branch');
});

app.get('/withdraw/select-product', isAuthenticated, authorizeRoles([ "Staff", "StaffBranch"]), (req, res) => {
    const branchId = req.query.branch_id;
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
            res.render('withdraw_list', { branchId : branchId,
                data: rows, 
                currentPage: page, totalPages: totalPages
            });
        });
    });
    
});

app.get('/withdraw-scan/:id', isAuthenticated, authorizeRoles([ "Staff", "StaffBranch"]), (req, res) => {
    res.render('withdraw_branch_scan', {data:req.params.id});
});

app.get('/middle/withdraw/:id', isAuthenticated, authorizeRoles([ "Staff", "StaffBranch"]), (req, res) => {
    res.redirect(`/withdraw/item/${req.params.id}/${req.query.branch_id}`);
});

app.get('/withdraw/item/:id/:branch', isAuthenticated, authorizeRoles([ "Staff", "StaffBranch"]), (req, res) => {
    const errorMap = {
        invalid_quantity: "จำนวนสินค้าไม่ถูกต้อง กรุณาระบุจำนวนที่มากกว่า 0",
        insufficient_stock: "ยอดสต็อกไม่เพียงพอสำหรับการเบิกจำนวนที่ระบุ",
        db_error: "เกิดข้อผิดพลาดในฐานข้อมูล กรุณาลองใหม่อีกครั้ง",
        success: "success",
    };
    const error = errorMap[req.query.error] || null;
fetch(`http://localhost:${port}/api/product/${req.params.id}`, { headers: { cookie: req.headers.cookie }})
        .then(response => response.json())
        .then(data => {
            res.render('withdraw_form', {product: data, branchId: req.params.branch, error: error});
        })
        .catch(error => console.error('Error loading page:', error))
});

app.post('/withdraw/confirm/:id/:branch', isAuthenticated, authorizeRoles([ "Staff", "StaffBranch"]),  (req, res) => {
    const {  quantity,  note } = req.body;
    const branch_id = req.params.branch;
    const product_id = req.params.id;
    const withdrawQty = parseInt(quantity, 10);
    const employee_id = req.session.user.emp_id;
    const backUrl = `/withdraw/item/${product_id}/${branch_id}`;

    
    if (!product_id || isNaN(withdrawQty) || withdrawQty <= 0) {
        return res.redirect(`${backUrl}?error=invalid_quantity`);
    }

    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const transaction_date = (new Date(now - tzOffset)).toISOString().slice(0, 19).replace('T', ' ');
    const transaction_type = 'จ่ายสินค้า';

    
    const selectLotsSql = `
        SELECT lot_id, quantity, lot_batch_code 
        FROM Lots 
        WHERE product_id = ? AND quantity > 0 
        ORDER BY mfg_date ASC, exp_date ASC, lot_id ASC
    `;

    db.all(selectLotsSql, [product_id], (err, lots) => {
        if (err) {
            console.error("Error fetching lots:", err.message);
            return res.redirect(`${backUrl}?error=db_error`);
        }

        
        const totalAvailable = lots.reduce((sum, lot) => sum + lot.quantity, 0);
        if (totalAvailable < withdrawQty) {
            return res.redirect(`${backUrl}?error=insufficient_stock`);
        }

        
        let remainingToWithdraw = withdrawQty;
        const updates = [];

        for (let lot of lots) {
            if (remainingToWithdraw <= 0) break;

            if (lot.quantity >= remainingToWithdraw) {
                updates.push({ lot_id: lot.lot_id, newQty: lot.quantity - remainingToWithdraw });
                remainingToWithdraw = 0; 
            } else {
                updates.push({ lot_id: lot.lot_id, newQty: 0 });
                remainingToWithdraw -= lot.quantity;
            }
        }

        
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            
            updates.forEach(update => {
                db.run(`UPDATE Lots SET quantity = ? WHERE lot_id = ?`, [update.newQty, update.lot_id], function(updateErr) {
                    if (updateErr) {
                        console.error(`Error updating Lot (lot_id: ${update.lot_id}):`, updateErr.message);
                    } else {
                        console.log(`อัปเดตสต็อก Lot lot_id ${update.lot_id} สำเร็จ: เหลือยอด ${update.newQty}`);
                    }
                });
            });

            
            const finalNote = branch_id ? `เบิกไปสาขา ${branch_id} | ${note || ''}` : (note || '');
            const sqlInsertTx = `INSERT INTO Transactions (product_id, employee_id, change_amount, transaction_type, transaction_date, destination_branch, note) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            
            db.run(sqlInsertTx, [product_id, employee_id, withdrawQty, transaction_type, transaction_date, branch_id, finalNote], function(txErr) {
                if (txErr) {
                    db.run("ROLLBACK");
                    console.error("Error inserting transaction:", txErr.message);
                    return res.redirect(`${backUrl}?error=db_error`);
                }

                
                db.run("COMMIT", (commitErr) => {
                    if (commitErr) {
                        console.error("Commit error:", commitErr);
                        return res.redirect(`${backUrl}?error=db_error`);
                    }
                    
                    
                    res.redirect(`${backUrl}?error=success`);
                });
            });
        });
    });
});

app.get("/scan", isAuthenticated, authorizeRoles([ "Staff", "StaffBranch"]), (req, res) => {
    res.render("scan", { 
        user: req.session.user 
    });
});
app.get('/fetch-product/:page/:ejsName', isAuthenticated, authorizeRoles(["Manager", "Staff", "StaffBranch"]), (req, res) => {
    const limit = 18; const page = parseInt(req.params.page) || 1; const offset = (page - 1) * limit;
    const q = req.query.q || ''; const category = req.query.category || ''; const brand = req.query.brand || ''; const branchId = req.query.branch_id || '';

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
            res.render(req.params.ejsName, {ejsName:req.params.ejsName, data: rows, currentPage: page, totalPages: totalPages,branchId: branchId }, (err, html) => {
                if (err) return res.status(500).json({ error: "Render error" });
                res.json({ html: html });
            });
        });
    });
});

app.get("/api/product/:id", isAuthenticated, authorizeRoles(["Manager", "Staff" , "StaffBranch"]), (req, res) => {
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


app.get("/api/notifications/count", isAuthenticated, (req, res) => {
    const sql = `
        SELECT COUNT(*) as count 
        FROM Lots 
        WHERE exp_date <= date('now', '+30 days') AND quantity > 0
    `;
    
    db.get(sql, [], (err, row) => {
        if (err) return res.status(500).json({ count: 0 });
        res.json({ count: row.count });
    });
});
app.get("/api/notifications/latest", isAuthenticated, (req, res) => {
    const sql = `
        SELECT p.product_name, l.exp_date, l.quantity
        FROM Lots l
        JOIN Products p ON l.product_id = p.product_id
        WHERE l.exp_date <= date('now', '+30 days') AND l.quantity > 0
        ORDER BY l.exp_date ASC
        LIMIT 5
    `;
    
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
            count: rows.length,
            items: rows
        });
    });
});

app.get("/expiry", isAuthenticated, (req, res) => {
    const query = `
        SELECT p.product_id as sku, p.product_name, l.lot_batch_code, l.quantity, l.exp_date
        FROM Lots l
        JOIN Products p ON l.product_id = p.product_id
        WHERE l.exp_date <= date('now', '+30 days') AND l.exp_date >= date('now')
        ORDER BY l.exp_date ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Database Error");
        }
        
        res.render("expiry", { expiringProducts: rows, user: req.session.user });
    });
});

app.post('/api/brands', isAuthenticated, authorizeRoles(['Manager', 'Staff']), (req, res) => {
    const { brand_name } = req.body;
    if (!brand_name || brand_name.trim() === '')
        return res.status(400).json({ error: 'กรุณาระบุชื่อแบรนด์' });

    db.get(`SELECT brand_id FROM Brands WHERE brand_name = ?`, [brand_name.trim()], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(409).json({ error: 'ชื่อแบรนด์นี้มีอยู่ในระบบแล้ว' });

        db.run(`INSERT INTO Brands (brand_name) VALUES (?)`, [brand_name.trim()], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const newBrand = { brand_id: this.lastID, brand_name: brand_name.trim() };
            app.locals.brands = [...(app.locals.brands || []), newBrand]
                .sort((a, b) => a.brand_name.localeCompare(b.brand_name));
            res.status(201).json(newBrand);
        });
    });
});

app.post('/api/categories', isAuthenticated, authorizeRoles(['Manager', 'Staff']), (req, res) => {
    const { category_name } = req.body;
    if (!category_name || category_name.trim() === '')
        return res.status(400).json({ error: 'กรุณาระบุชื่อประเภทสินค้า' });

    db.get(`SELECT category_id FROM Categories WHERE category_name = ?`, [category_name.trim()], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(409).json({ error: 'ประเภทสินค้านี้มีอยู่ในระบบแล้ว' });

        db.run(`INSERT INTO Categories (category_name) VALUES (?)`, [category_name.trim()], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const newCategory = { category_id: this.lastID, category_name: category_name.trim() };
            app.locals.categories = [...(app.locals.categories || []), newCategory]
                .sort((a, b) => a.category_name.localeCompare(b.category_name));
            res.status(201).json(newCategory);
        });
    });
});

app.post('/api/suppliers', isAuthenticated, authorizeRoles(['Manager', 'Staff']), (req, res) => {
    const { supplier_name } = req.body;
    if (!supplier_name || supplier_name.trim() === '')
        return res.status(400).json({ error: 'กรุณาระบุชื่อซัพพลายเออร์' });

    db.get(`SELECT supplier_id FROM Suppliers WHERE supplier_name = ?`, [supplier_name.trim()], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(409).json({ error: 'ซัพพลายเออร์นี้มีอยู่ในระบบแล้ว' });

        db.run(`INSERT INTO Suppliers (supplier_name) VALUES (?)`, [supplier_name.trim()], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const newSupplier = { supplier_id: this.lastID, supplier_name: supplier_name.trim() };
            app.locals.suppliers = [...(app.locals.suppliers || []), newSupplier]
                .sort((a, b) => a.supplier_name.localeCompare(b.supplier_name));
            res.status(201).json(newSupplier);
        });
    });
});

app.get('/select-path/:id', isAuthenticated, authorizeRoles(['StaffBranch', 'Staff']), (req, res) => {
    res.render('selectPath', {data:req.params.id});
});


app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});