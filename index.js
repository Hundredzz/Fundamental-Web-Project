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
        // Files will be saved in 'public/img/product_image'
        // Make sure this folder exists in your project structure!
        cb(null, path.join(__dirname, 'public/img/product_image'));
    },
    filename: function (req, file, cb) {
        const d = new Date();
        
        // Get the date parts and ensure they are 2 digits (e.g., '03' instead of '3')
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0'); // Months are 0-11, so we add 1
        const date = String(d.getDate()).padStart(2, '0');
        
        const milli = String(d.getMilliseconds()).padStart(3, '0'); // Milliseconds are 3 digits

        // Combine them into your custom prefix!
        // Format: YYYYMMDD_HHMMSS_mmm
        const prefix = `${year}${month}${date}_${milli}`;

        // Add the original file extension at the end (e.g., .jpg, .png)
        cb(null, prefix + '_' + file.originalname);
    }
})

// Connect to SQLite database
let db = new sqlite3.Database('Warehouse.db', (err) => {
    if (err) {
        return console.error(err.message);
    }
    console.log('Connected to the SQlite database.');

    loadData();
});

let global_brands = [];
let global_categories = [];
let global_supplier = [];

const uploader = multer({ storage: storageConfig });

function loadData() {
    db.all(`SELECT * FROM Categories ORDER BY category_name`, [], (err, categories) => {
        if (!err) global_categories = categories;
    });
    db.all(`SELECT * FROM Brands ORDER BY brand_name`, [], (err, brands) => {
        if (!err) global_brands = brands;
    });
    db.all(`SELECT * FROM Suppliers ORDER BY supplier_name`, [], (err, suppliers) => {
        if (!err) global_supplier = suppliers;
    });
}



app.get("/", (req, res) => {

    // ------------------------------------------------------

    // 2. If no user is logged in, show the login page as usual
    let errorMessage = null;

    if (req.query.error === "notfound") {
        errorMessage = "ไม่พบบัญชีผู้ใช้งาน หรืออีเมลนี้ในระบบ";
    } else if (req.query.error === "inactive") {
        errorMessage = "บัญชีนี้ถูกระงับการใช้งาน";
    } else if (req.query.error === "wrongpassword") {
        errorMessage = "รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง";
    }

    res.render("login", { error: errorMessage });
});

app.get("/addUser", (req, res) => {
    let errorMessage = null;
    res.render("addUser", { error: errorMessage });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;

    // I added Users.username to the SELECT statement so we can save it to the session
    const sql = `SELECT Users.username, Users.password, Users.status
        FROM Users 
        INNER JOIN Employees ON Users.employee_id = Employees.employee_id 
        WHERE Users.username = ? OR Employees.email = ?`;

    // 1. Find the user in the database
    db.get(sql, [username, username], (err, row) => {
        if (err) return res.status(500).send(err.message);

        if (!row) {
            return res.redirect("/?error=notfound");
        }

        if (row.status === "Inactive") {
            return res.redirect("/?error=inactive");
        }

        // 2. Split the saved password string back into the salt and the hash
        const savedPassword = row.password;
        const [salt, originalHash] = savedPassword.split(":");

        // 3. Hash the login attempt using the exact SAME salt
        crypto.scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) return res.status(500).send("Hashing error");

            const attemptHash = derivedKey.toString("hex");

            // 4. Compare the new hash to the original hash
            if (attemptHash === originalHash) {
                req.session.user = {
                    username: row.username,
                    role: row.role // Assuming your DB has a role column
                };
                res.redirect("/dashboard");
            } else {
                res.redirect("/?error=wrongpassword");
            }
        });
    });
});

app.get("/receive", (req, res) => { 
    res.render("receive_stock");
});

app.post("/add", (req, res) => {
    const { username, password } = req.body;

    const salt = crypto.randomBytes(16).toString("hex");

    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
        if (err) return res.status(500).send("Hashing error");

        const hash = derivedKey.toString("hex");
        const passwordToSave = `${salt}:${hash}`;

        db.run(`INSERT INTO Users (username, password, role) VALUES (?, ?, ?)`, [username, passwordToSave, "Staff"], function (err) {
            if (err) return console.error(err.message);
            res.send("User registered securely without bcrypt!");
        });
    });
});
app.get("/mainpage", (req, res) => {
    res.render("mainpage");
});
app.get("/history", (req, res) => {
    res.render("history");
});
app.get("/undefind", (req, res) => {
    res.render("undefind");
});
app.get("/manage", (req, res) => {
    const id = req.query.id || '';
    const username = req.query.username || '';
    const name = req.query.name || '';
    const job_title = req.query.job_title || '';
    const role = req.query.role || '';

    // 2. Base query using WHERE 1=1
    let sql = `
        SELECT 
            u.username, 
            u.role, 
            u.status,
            e.employee_id, 
            e.first_name, 
            e.last_name, 
            e.job_title
        FROM Users u
        LEFT JOIN Employees e ON u.employee_id = e.employee_id
        WHERE 1=1
    `;

    let queryParams = [];

    // 3. Dynamically add filters if the user provided them
    if (id.trim() !== '') {
        sql += ` AND e.employee_id LIKE ?`;
        queryParams.push(`%${id}%`); // Use % for partial matches
    }
    
    if (username.trim() !== '') {
        sql += ` AND u.username LIKE ?`;
        queryParams.push(`%${username}%`);
    }
    
    if (name.trim() !== '') {
        // Search both first and last name for the text
        sql += ` AND (e.first_name LIKE ? OR e.last_name LIKE ?)`;
        queryParams.push(`%${name}%`, `%${name}%`);
    }
    
    if (job_title.trim() !== '') {
        sql += ` AND e.job_title = ?`; // Exact match for dropdowns
        queryParams.push(job_title);
    }
    
    if (role.trim() !== '') {
        sql += ` AND u.role = ?`; // Exact match for dropdowns
        queryParams.push(role);
    }

    // 4. Add the Order By to the end
    sql += ` ORDER BY e.employee_id ASC`;

    // 5. Execute the query
    db.all(sql, queryParams, (err, rows) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).send("เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้งาน");
        }

        // 6. Send the retrieved data to the EJS template
        res.render("manage", { users: rows });
    });
});
app.get("/manageEdit", (req, res) => {
    res.render("manageEdit");
});
app.get("/report", (req, res) => {
    res.render("report");
});
app.get("/createReport", (req, res) => {
    res.render("createReport");
});

// --- NEW PROTECTED ROUTE: Dashboard ---
app.get("/dashboard", (req, res) => {

    if (!req.session.user) {
        return res.redirect("/?error=notfound");
    }

    // If valid, let them in and pass their name to the frontend!
    res.render("home", { username: req.session.user.username });
});
// --------------------------------------

app.get("/product", (req, res) => {
    lastProductQuery = null;
    lastCountQuery = null;
    lastSearchText = null;
    const limit = 18;
    const page = 1;
    const offset = 0;

    const query = `SELECT p.product_name AS product_name, p.img_path AS img_path, p.product_id AS product_id, c.category_name AS category_name, b.brand_name AS brand_name, COALESCE(SUM(l.quantity), 0) AS total_quantity
                FROM Products p 
                LEFT JOIN Categories c ON p.category_id = c.category_id 
                LEFT JOIN Brands b ON p.brand_id = b.brand_id 
                LEFT JOIN Lots l ON p.product_id = l.product_id
                GROUP BY p.product_id ORDER BY p.product_name ASC
                LIMIT ? OFFSET ?`;

    const countQuery = `SELECT COUNT(*) AS count FROM products`

    lastProductQuery = query;
    lastCountQuery = countQuery;

    db.all(countQuery, (err, row) => {
        if (err) return res.status(500).send("Database error");

        const totalPages = Math.ceil(row[0].count / limit);

        db.all(query, [limit, offset], (err, rows) => {
            if (err) return res.status(500).send("Database error");
            res.render('showProduct', {
                data: rows, categories: global_categories,
                brands: global_brands, currentPage: page, totalPages: totalPages
            });
        });
    });
});



app.get('/search', (req, res) => {
    // 1. Grab all values from the URL
    const q = req.query.q || '';
    const category = req.query.category || '';
    const brand = req.query.brand || '';

    const limit = 18;
    const page = 1;
    const offset = 0;

    // 2. Base queries using WHERE 1=1
    let sql = `SELECT p.product_name AS product_name, p.img_path AS img_path, p.product_id AS product_id, c.category_name AS category_name, b.brand_name AS brand_name, COALESCE(SUM(l.quantity), 0) AS total_quantity
               FROM Products p 
               LEFT JOIN Categories c ON p.category_id = c.category_id 
               LEFT JOIN Brands b ON p.brand_id = b.brand_id 
               LEFT JOIN Lots l ON p.product_id = l.product_id
               WHERE 1=1`;

    // Use COUNT(DISTINCT) so we don't accidentally count lots instead of products
    let countQuery = `SELECT COUNT(*) AS count 
                      FROM Products p 
                      LEFT JOIN Categories c ON p.category_id = c.category_id 
                      LEFT JOIN Brands b ON p.brand_id = b.brand_id
                      WHERE 1=1`;

    let queryParams = [];

    // 3. Dynamically add filters if the user provided them
    if (q.trim() !== '') {
        sql += ` AND (p.product_name LIKE ? OR p.product_id LIKE ?)`;
        countQuery += ` AND (p.product_name LIKE ? OR p.product_id LIKE ?)`;
        queryParams.push(`%${q}%`, `%${q}%`);
    }
    if (category.trim() !== '') {
        sql += ` AND c.category_name = ?`;
        countQuery += ` AND c.category_name = ?`;
        queryParams.push(category);
    }
    if (brand.trim() !== '') {
        sql += ` AND b.brand_name = ?`;
        countQuery += ` AND b.brand_name = ?`;
        queryParams.push(brand);
    }

    // 4. Add the Group By and Order By to the end
    sql += ` GROUP BY p.product_id ORDER BY p.product_name ASC`;

    // 5. Save state for pagination
    lastProductQuery = sql;
    lastCountQuery = countQuery;
    lastQueryParams = queryParams;

    // 6. Execute Count
    db.get(countQuery, queryParams, (err, row) => {
        if (err) return res.status(500).json({ error: "Database error" });
        const totalPages = Math.ceil(row.count / limit);

        // 7. Add Limit and Offset and execute main query
        const finalSql = sql + ` LIMIT ? OFFSET ?`;
        const finalParams = [...queryParams, limit, offset]; // Unpack array using spread operator

        db.all(finalSql, finalParams, (err, rows) => {
            if (err) return res.status(500).json({ error: "Database error" });
            res.render('productSection', {
                data: rows, currentPage: page, totalPages: totalPages
            }, (err, html) => {
                if (err) return res.status(500).json({ error: "Render error" });
                res.json({ html: html });
            });
        });
    });
});

app.get('/edit-product/:id', (req, res) => {
    fetch(`http://localhost:${port}/api/product/${req.params.id}`)
        .then(response => response.json())
        .then(data => {
            res.render('editProduct', { product: data, title: 'แก้ไขสินค้า', brands: global_brands, categories: global_categories, suppliers:global_supplier, url_path : "/update-product"});
        })
        .catch(error => {
            console.error('Error loading page:', error);
        })
});

app.get('/add-peoduct', (req, res) => {
    db.get(`SELECT product_id FROM Products WHERE product_id LIKE 'B%' ORDER BY product_id DESC LIMIT 1`, [], (err, row) => {
        if (err) {
            console.error("Database Error:", err);
            return res.status(500).send("เกิดข้อผิดพลาดในการสร้างรหัสสินค้า");
        }

        let newProductId = "B000001"; // Default starting ID if the database is completely empty

        // 2. If we found a previous ID (like "B0096286"), calculate the next one
        if (row && row.product_id) {
            // Cut off the 'B' (leaves us with "0096286")
            const numberString = row.product_id.substring(1);
            
            // Convert to a real number and add 1 (becomes 96287)
            const nextNumber = parseInt(numberString, 10) + 1;
            
            // Format it back to 6 digits by padding with zeros, then stick the 'B' back on
            newProductId = "B" + String(nextNumber).padStart(6, '0');
        }

        // 3. Create a dummy product object so the EJS file doesn't crash 
        // when it tries to read product.product_name, etc.
        const newProductTemplate = {
            product_id: newProductId, // <-- Here is our auto-generated ID!
            product_name: "",
            brand_name: "",
            category_name: "",
            supplier_name: "",
            net_content: "",
            cost_price: "",
            selling_price: "",
            fda_number: "",
            img_path: null
        };

        // 4. Render the page with the prepopulated object
        res.render('editProduct', { 
            product: newProductTemplate, 
            title: 'เพิ่มสินค้า', 
            brands: global_brands, 
            categories: global_categories, 
            suppliers: global_supplier,
            url_path : "/add-product-data"
        });
    });
});

// --- 2. THE PAGINATION ROUTE ---
app.get('/fetch-product/:page', (req, res) => {
    // 1. Grab pagination AND search values from the request
    const limit = 18;
    const page = parseInt(req.params.page) || 1;
    const offset = (page - 1) * limit;

    const q = req.query.q || '';
    const category = req.query.category || '';
    const brand = req.query.brand || '';

    // 2. Base queries
    let sql = `SELECT p.product_name AS product_name, p.img_path AS img_path, p.product_id AS product_id, c.category_name AS category_name, b.brand_name AS brand_name, COALESCE(SUM(l.quantity), 0) AS total_quantity
               FROM Products p 
               LEFT JOIN Categories c ON p.category_id = c.category_id 
               LEFT JOIN Brands b ON p.brand_id = b.brand_id 
               LEFT JOIN Lots l ON p.product_id = l.product_id
               WHERE 1=1`;

    let countQuery = `SELECT COUNT(*) AS count 
                      FROM Products p 
                      LEFT JOIN Categories c ON p.category_id = c.category_id 
                      LEFT JOIN Brands b ON p.brand_id = b.brand_id
                      WHERE 1=1`;

    let queryParams = [];

    // 3. Apply filters
    if (q.trim() !== '') {
        sql += ` AND (p.product_name LIKE ? OR p.product_id LIKE ?)`;
        countQuery += ` AND (p.product_name LIKE ? OR p.product_id LIKE ?)`;
        queryParams.push(`%${q}%`, `%${q}%`);
    }
    if (category.trim() !== '') {
        sql += ` AND c.category_name = ?`;
        countQuery += ` AND c.category_name = ?`;
        queryParams.push(category);
    }
    if (brand.trim() !== '') {
        sql += ` AND b.brand_name = ?`;
        countQuery += ` AND b.brand_name = ?`;
        queryParams.push(brand);
    }

    sql += ` GROUP BY p.product_id ORDER BY p.product_name ASC`;

    // 4. Execute the count, then the main query
    db.get(countQuery, queryParams, (err, row) => {
        if (err) return res.status(500).json({ error: "Database error" });
        const totalPages = Math.ceil(row.count / limit);

        const finalSql = sql + ` LIMIT ? OFFSET ?`;
        const finalParams = [...queryParams, limit, offset];

        db.all(finalSql, finalParams, (err, rows) => {
            if (err) return res.status(500).json({ error: "Database error" });
            res.render('productSection', {
                data: rows, currentPage: page, totalPages: totalPages
            }, (err, html) => {
                if (err) return res.status(500).json({ error: "Render error" });
                res.json({ html: html });
            });
        });
    });
});

app.get("/api/product/:id", (req, res) => {
    const productId = req.params.id;

    // We join tables here too, just in case you want to show Brand/Category names
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
        if (err) {
            console.error(err.message);
            return res.status(500).json({ error: "Database error" });
        }
        if (!row) {
            return res.status(404).json({ error: "Product not found" });
        }
        // Send the data back as a JSON object
        console.log(row);
        res.json(row);
    });
});

app.post("/update-product", uploader.single('product_image'), (req, res) => {
    
    const { 
        code, name, brand, category, supplier, 
        net_content, cost_price, selling_price, fda_no 
    } = req.body;

    // SCENARIO A: They uploaded a NEW image
    if (req.file) {
        const newImagePath = req.file.filename;

        // 1. First, find out what the OLD image was
        db.get(`SELECT img_path FROM Products WHERE product_id = ?`, [code], (err, row) => {
            if (err) {
                console.error("Database Error:", err);
                return res.status(500).send("เกิดข้อผิดพลาดในการดึงข้อมูลรูปภาพเก่า");
            }

            // 2. If an old image exists, delete it from the folder!
            if (row && row.img_path) {
                const oldImageFullPath = path.join(__dirname, 'public/img/product_image', row.img_path);
                
                // fs.unlink deletes the file. 
                fs.unlink(oldImageFullPath, (unlinkErr) => {
                    // We ignore 'ENOENT' (Error NO ENTry) which just means the file was already missing
                    if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                        console.error("Failed to delete old image:", unlinkErr);
                    } else {
                        console.log("Old image deleted successfully.");
                    }
                });
            }

            // 3. Now, update the database with the NEW image path
            const sql = `
                UPDATE Products 
                SET 
                    product_name = ?, brand_id = ?, category_id = ?, supplier_id = ?, 
                    net_content = ?, cost_price = ?, selling_price = ?, fda_number = ?, 
                    img_path = ? 
                WHERE product_id = ?
            `;
            const params = [name, brand, category, supplier, net_content, cost_price, selling_price, fda_no, newImagePath, code];

            db.run(sql, params, function(err) {
                if (err) return res.status(500).send("เกิดข้อผิดพลาดในการบันทึกข้อมูลสินค้า");
                console.log(`Product ${code} updated with new image!`);
                res.redirect("/product"); 
            });
        });

    } else {
        // SCENARIO B: They did NOT upload a new image.
        // Keep the existing code you already had for this part!
        const sql = `
            UPDATE Products 
            SET 
                product_name = ?, brand_id = ?, category_id = ?, supplier_id = ?, 
                net_content = ?, cost_price = ?, selling_price = ?, fda_number = ?
            WHERE product_id = ?
        `;
        const params = [name, brand, category, supplier, net_content, cost_price, selling_price, fda_no, code];

        db.run(sql, params, function(err) {
            if (err) return res.status(500).send("เกิดข้อผิดพลาดในการบันทึกข้อมูลสินค้า");
            console.log(`Product ${code} updated (no image change).`);
            res.redirect("/product"); 
        });
    }
});

app.post("/add-product-data", uploader.single('product_image'), (req, res) => {
    const { 
        code,           // product_id (e.g., B000001)
        name,           // product_name
        brand,          // brand_id
        category,       // category_id
        supplier,       // supplier_id
        net_content, 
        cost_price, 
        selling_price, 
        fda_no 
    } = req.body;

    // 2. Handle the image path
    // If the user uploaded an image, save the new filename. If they skipped it, set it to null.
    const imagePath = req.file ? req.file.filename : null;

    // 3. Prepare the SQL INSERT statement
    const sql = `
        INSERT INTO Products (
            product_id, 
            product_name, 
            brand_id, 
            category_id, 
            supplier_id, 
            net_content, 
            cost_price, 
            selling_price, 
            fda_number, 
            img_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
        code, 
        name, 
        brand, 
        category, 
        supplier, 
        net_content, 
        cost_price, 
        selling_price, 
        fda_no, 
        imagePath
    ];

    // 4. Execute the insert
    db.run(sql, params, function(err) {
        if (err) {
            console.error("Database Insert Error:", err.message);
            
            // If the user somehow submitted a product ID that already exists, SQLite will throw a UNIQUE constraint error
            if (err.message.includes("UNIQUE constraint failed: Products.product_id")) {
                return res.status(400).send("เกิดข้อผิดพลาด: รหัสสินค้านี้มีอยู่ในระบบแล้ว");
            }

            return res.status(500).send("เกิดข้อผิดพลาดในการเพิ่มสินค้าใหม่");
        }

        console.log(`New product added successfully! ID: ${code}`);
        
        // 5. Redirect back to the main product catalog after successful insertion
        res.redirect("/product");
    });
});

app.delete("/delete-product/:id", (req, res) => {
    const productId = req.params.id;

    // 1. Get the image path
    db.get(`SELECT img_path FROM Products WHERE product_id = ?`, [productId], (err, row) => {
        if (err) return res.status(500).json({ error: "Database Error" });

        // 2. Delete linked data (Lots) so the database doesn't block you
        db.serialize(() => {
            
            // A. Delete Transactions linked to this product's lots
            db.run(`DELETE FROM Transactions WHERE product_id = ?`, [productId]);
            
            // B. Delete the Lots
            db.run(`DELETE FROM Lots WHERE product_id = ?`, [productId]);
            
            // C. Finally, Delete the Product itself
            db.run(`DELETE FROM Products WHERE product_id = ?`, [productId], function(deleteErr) {
                if (deleteErr) {
                    console.error("Delete Error:", deleteErr);
                    // FIXED: Send an error JSON instead of using res.send for fetch requests
                    return res.status(500).json({ error: "เกิดข้อผิดพลาดในการลบสินค้า" }); 
                }

                // D. If the database delete was successful, wipe the image from the folder!
                if (row && row.img_path) {
                    const imagePath = path.join(__dirname, 'public/img/product_image', row.img_path);
                    fs.unlink(imagePath, (unlinkErr) => {
                        if (unlinkErr && unlinkErr.code !== 'ENOENT') console.error("Failed to delete image:", unlinkErr);
                    });
                }

                console.log(`Product ${productId} completely wiped from existence.`);
                
                // FIXED: Send a 200 OK status back so the frontend JS knows it's safe to reload the page
                res.sendStatus(200); 
            });
        });
    });
});

app.get('/receive-stock', (req, res) => {
    const products = [
        { id: 1, name: 'Foundation' },
        { id: 2, name: 'Concealer' }
    ];

    res.render('receive_stock', { 
        products: products 
    });
});

app.get('/receive/add/:id', (req, res) => {
    const brandId = req.params.id;

    db.get("SELECT * FROM brands WHERE brand_id = ?", [brandId], (err, row) => {
        if (err || !row) {
            return res.redirect('/receive');
        }

        res.render('receive_form', { 
            brand_id: row.brand_id, 
            brand_name: row.brand_name 
        });
    });
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// ตรวจสอบและสร้างตาราง stock หากยังไม่มีอยู่
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS stock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand_id INTEGER,
        quantity INTEGER,
        lot_number TEXT,
        mfd_date TEXT,
        exp_date TEXT,
        supplier TEXT,
        remark TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, 
    (err) => {
        if (err) {
            console.error("สร้างตารางไม่สำเร็จ:", err.message);
        } else {
            console.log("ตาราง stock พร้อมใช้งานแล้ว");
        }
    });
});
app.post('/save-stock', (req, res) => {
    console.log("ข้อมูลที่รับมา:", req.body);

    const { brand_id, quantity, lot_number, mfd_date, exp_date, supplier, remark } = req.body;
    const sql = `INSERT INTO stock (brand_id, quantity, lot_number, mfd_date, exp_date, supplier, remark) VALUES (?, ?, ?, ?, ?, ?, ?)`;

    db.run(sql, [brand_id, quantity, lot_number, mfd_date, exp_date, supplier, remark], function(err) {
        if (err) {
            console.error("SQL Error:", err.message);
            return res.status(500).send("เกิดข้อผิดพลาด: " + err.message);
        }
        res.render('receive_success');
    });
});

app.get('/withdraw', (req, res) => {
    res.render('withdraw_branch');
});

app.get('/withdraw/select-product', (req, res) => {
    const branchId = req.query.branch_id;
    const products = [{id: 1, name: 'Foundation'}, {id: 2, name: 'Concealer'}];
    res.render('withdraw_list', { branchId, branchName: 'สาขา ' + branchId, products });
});

app.get('/withdraw/item/:id', (req, res) => {
    const productId = req.params.id;
    const branchId = req.query.branch;
    
    let productName = "";
    if (productId == "1") productName = "Foundation";
    else if (productId == "2") productName = "Concealer";
    else productName = "สินค้าทั่วไป";

    res.render('withdraw_form', { 
        productId: productId,
        productName: productName,
        branchId: branchId
    });
});

app.post('/withdraw/confirm', (req, res) => {
    res.render('withdraw_success');
});

app.get('/scan', (req, res) => {
    res.render('scan');
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
