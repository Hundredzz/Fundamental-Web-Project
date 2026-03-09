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
                    <p>ขออภัย คุณไม่มีสิทธิ์เข้าถึงหน้านี้</p>
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
                // Save complete user info to session
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
                currentPage: page, totalPages: totalPages
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

        // จัดฟอร์แมตวันที่อัปเดตล่าสุดให้สวยงาม (เช่น 07/03/2026, 15:30)
        let formattedLastUpdate = "ยังไม่มีข้อมูล";
        if (row.last_update) {
            const d = new Date(row.last_update);
            formattedLastUpdate = d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
        }

        // เตรียมข้อมูลส่งไปที่ EJS
        const dashData = {
            totalProducts: row.total_products || 0,
            lastUpdate: formattedLastUpdate,
            totalStock: row.total_stock || 0,
            dailyChange: row.daily_change || 0,
            expiringSoon: row.expiring_soon || 0,
            expired: row.expired || 0
        };

        // ส่งข้อมูล dashData ไปที่ไฟล์ mainpage.ejs
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

        // Pass the fetched rows to your history.ejs file as 'transactions'
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
    // รับค่าพารามิเตอร์ที่ส่งมาจาก Frontend
    const { reportType, startDate, endDate, productName, brandId, sortBy, expireDays, transType, employee_name, productLeft,lotCode } = req.query;

    let sql = "";
    let queryParams = [];

    // ==========================================
    // 1. รายงานความเคลื่อนไหวของสินค้า (Inventory Movement)
    // ==========================================
    if (reportType === 'movement') {
    // หมายเหตุ: สังเกตว่าผมเปลี่ยน t.quantity เป็น t.change_amount ตามโค้ดหน้า EJS ของคุณแล้ว
    // (หากใน Database ของคุณชื่อคอลัมน์ยังเป็น quantity อยู่ ให้แก้เป็น t.quantity AS change_amount นะครับ)
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

    // 1. กรองตามวันที่
    if (startDate) { 
        sql += ` AND t.transaction_date >= ?`; 
        queryParams.push(`${startDate} 00:00:00`); 
    }
    if (endDate) { 
        sql += ` AND t.transaction_date <= ?`; 
        queryParams.push(`${endDate} 23:59:59`); 
    }
    
    // 2. กรองตามชื่อหรือรหัสสินค้า
    if (productName) { 
        sql += ` AND (p.product_id LIKE ? OR p.product_name LIKE ?)`; 
        queryParams.push(`%${productName}%`, `%${productName}%`); 
    }

    // 3. กรองตามประเภทรายการ (รับสินค้า / จ่ายสินค้า)
    if (transType) {
        sql += ` AND t.transaction_type = ?`;
        queryParams.push(transType);
    }

    // 4. กรองตามชื่อ-นามสกุลผู้ทำรายการ
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
        // *หมายเหตุ: ถ้าคอลัมน์ในฐานข้อมูลคุณชื่อ quantity ให้เปลี่ยน t.change_amount เป็น t.quantity แทนนะครับ
        sql += ` ORDER BY t.change_amount DESC`; 
    } else if (sortBy === 'amount_asc') {
        sql += ` ORDER BY t.change_amount ASC`;
    } else {
        // ค่าเริ่มต้น ถ้าไม่ได้เลือกอะไรให้เรียงวันที่ใหม่สุดขึ้นก่อน
        sql += ` ORDER BY t.transaction_date DESC`;
    }
    // ==========================================
    // 2. รายงานสต็อกสินค้าคงเหลือ (Stock Balance)
    // ==========================================
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

    // 📌 จัดการเงื่อนไขการเรียงลำดับ (ORDER BY)
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
        // ค่าเริ่มต้น
        sql += ` ORDER BY p.product_id ASC`;
    }
    // ==========================================
    // 3. รายงานสินค้าใกล้หมดอายุ (Expiring Products)
    // ==========================================
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
        // กรองตามแบรนด์
        if (brandId) {
            sql += ` AND p.brand_id = ?`;
            queryParams.push(brandId);
        }
        // กรองตามรหัสล็อต
        if (lotCode) {
            sql += ` AND l.lot_batch_code LIKE ?`;
            queryParams.push(`%${lotCode}%`);
        }

        // จัดการเงื่อนไขการเรียงลำดับ (ตาม value ใน EJS)
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
        // ถ้าส่ง reportType มาผิดเงื่อนไข
        return res.status(400).json({ error: "ประเภทรายงานไม่ถูกต้อง" });
    }

    // ==========================================
    // ทำการ Execute Query และส่งข้อมูลกลับไปที่ EJS
    // ==========================================
    db.all(sql, queryParams, (err, rows) => {
        if (err) {
            console.error("Report Database Error:", err.message); // ดู Error ใน Terminal ของ VS Code
            return res.status(500).json({ error: "เกิดข้อผิดพลาดในการดึงข้อมูลรายงาน" });
        }

        // Alternative Flow 1: ถ้าหาข้อมูลไม่เจอเลย
        if (rows.length === 0) {
            return res.status(404).json({ error: "ไม่พบข้อมูลในช่วงเวลาหรือเงื่อนไขที่เลือก" });
        }

        // ถ้าสำเร็จ ส่ง Data เป็น JSON กลับไปวาดตารางที่ Frontend
        res.json(rows);
    });
});

app.get("/export-report", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    // 1. อย่าลืมรับค่า sortBy เพิ่มมาตรงนี้ด้วย
    const { reportType, startDate, endDate, productName, brandId, sortBy, expireDays, type, employee_name, productLeft, lotCode } = req.query;
    let queryParams = [];
    let csvHeader = "";

    if (reportType === 'movement') {
        // ... (โค้ดรายงานความเคลื่อนไหวเดิมของคุณ) ...
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

    // 1. กรองตามวันที่
    if (startDate) { 
        sql += ` AND t.transaction_date >= ?`; 
        queryParams.push(`${startDate} 00:00:00`); 
    }
    if (endDate) { 
        sql += ` AND t.transaction_date <= ?`; 
        queryParams.push(`${endDate} 23:59:59`); 
    }
    
    // 2. กรองตามชื่อหรือรหัสสินค้า
    if (productName) { 
        sql += ` AND (p.product_id LIKE ? OR p.product_name LIKE ?)`; 
        queryParams.push(`%${productName}%`, `%${productName}%`); 
    }

    // 3. กรองตามประเภทรายการ (รับสินค้า / จ่ายสินค้า)
    if (type && type.trim() !== '') {
        sql += ` AND t.transaction_type = ?`;
        queryParams.push(type);
    }

    // 4. กรองตามชื่อ-นามสกุลผู้ทำรายการ
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
        // *หมายเหตุ: ถ้าคอลัมน์ในฐานข้อมูลคุณชื่อ quantity ให้เปลี่ยน t.change_amount เป็น t.quantity แทนนะครับ
        sql += ` ORDER BY t.change_amount DESC`; 
    } else if (sortBy === 'amount_asc') {
        sql += ` ORDER BY t.change_amount ASC`;
    } else {
        // ค่าเริ่มต้น ถ้าไม่ได้เลือกอะไรให้เรียงวันที่ใหม่สุดขึ้นก่อน
        sql += ` ORDER BY t.transaction_date DESC`;
    }

    // 📌 (เฉพาะใน Route /export-report) อย่าลืมอัปเดตบรรทัดการสร้าง CSV ด้วยนะครับ
    csvHeader = "วันที่,รหัสสินค้า,ชื่อสินค้า,ประเภทรายการ,จำนวน,ผู้ทำรายการ\n";
    

    // ==========================================
    // 2. แก้ไขรายงานสต็อกสินค้าตรงนี้
    // ==========================================
    } else if (reportType === 'stock') {
        // เพิ่ม LEFT JOIN Brands เข้าไปเผื่อจัดเรียงตามแบรนด์
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

        // 📌 เพิ่มเงื่อนไขการเรียงลำดับให้เหมือนตอนดึงข้อมูลเป๊ะๆ
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
        // ... (โค้ดรายงานหมดอายุเดิมของคุณ) ...
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
        // กรองตามแบรนด์
        if (brandId) {
            sql += ` AND p.brand_id = ?`;
            queryParams.push(brandId);
        }
        // กรองตามรหัสล็อต
        if (lotCode) {
            sql += ` AND l.lot_batch_code LIKE ?`;
            queryParams.push(`%${lotCode}%`);
        }

        // จัดการเงื่อนไขการเรียงลำดับ (ตาม value ใน EJS)
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

    // ทำการ Query ข้อมูลจาก Database และสร้าง CSV ตามเดิม...
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
                // ถ้ามีรหัสพนักงานนี้ในตาราง Employees อยู่แล้ว ให้รีไดเรกต์กลับไปพร้อม Error
                return res.redirect("/add-user?error=duplicate_employee");
            } else {
                db.serialize(() => {
                    const empSql = `INSERT INTO Employees (employee_id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?)`;
                    db.run(empSql, [employeeId, fname, lname, email, phone], function(empErr) {
                        if (empErr) {
                            // ดักจับกรณี Insert แล้วชน Unique Constraint เพิ่มเติม
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
                // ดักจับกรณีมีการแก้ไขรหัสพนักงานแล้วไปซ้ำ (ถ้าหน้าบ้านอนุญาตให้แก้)
                if (empErr.message.includes("UNIQUE constraint failed: Employees.employee_id")) {
                    return res.redirect(`/edit-user/${targetUserId}?error=duplicate_employee`);
                }
                return res.redirect(`/edit-user/${targetUserId}?error=db_error`);
            }

            // Update Users table
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
    // 1. Grab values from the URL query string
    const productNameSearch = req.query.productName || ''; 
    const startDateSearch = req.query.start_date || ''; // Maps to <input name="data">
    const endDateSearch = req.query.end_date || ''; // Maps to <input name="data">
    const typeSearch = req.query.type || ''; // "รับสินค้า" or "จ่ายสินค้า"
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

    // Search by Product name or ID
    if (productNameSearch.trim() !== '') {
        sql += ` AND (p.product_name LIKE ? OR t.product_id LIKE ?)`;
        queryParams.push(`%${productNameSearch}%`, `%${productNameSearch}%`);
    }

    // Search by Transaction Type
    if (typeSearch.trim() !== '') {
        sql += ` AND t.transaction_type = ?`; // **NOTE: Change t.transaction_type to match your DB column (e.g., t.type)**
        queryParams.push(typeSearch);
    }

    // Search by Date 
    if (startDateSearch.trim() !== '') {
        sql += ` AND t.transaction_date >= ?`;
        queryParams.push(`${startDateSearch} 00:00:00`); 
    }

    // Search by End Date
    if (endDateSearch.trim() !== '') {
        sql += ` AND t.transaction_date <= ?`;
        queryParams.push(`${endDateSearch} 23:59:59`); 
    }

    // Search by Employee Name (First Name, Last Name, or Username)
    if (employeeNameSearch.trim() !== '') {
        sql += ` AND Concat(e.first_name, ' ', e.last_name)LIKE ?`;
        queryParams.push(`%${employeeNameSearch.trim()}%`);
    }

    // Sort newest to oldest
    sql += ` ORDER BY t.transaction_date DESC`;

    db.all(sql, queryParams, (err, rows) => {
        if (err) {
            console.error("Database Error:", err.message); // This will print SQL errors in your VS Code terminal
            return res.status(500).json({ error: "เกิดข้อผิดพลาดในการค้นหาประวัติ" });
        }

        res.render('transactionSection', { transactions: rows }, (renderErr, htmlContent) => {
            if (renderErr) {
                console.error("Render Error:", renderErr.message); // This will print EJS errors in your terminal
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

// --- Product Routes ---
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
            
            // 2. ส่ง branchId กลับไปให้ EJS ด้วย
            res.render(req.params.ejsName, {
                ejsName: req.params.ejsName, 
                data: rows, 
                currentPage: page, 
                totalPages: totalPages,
                branchId: branchId  // <--- เพิ่มบรรทัดนี้
            }, (err, html) => {
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

    let note = remark || ''; // ถ้าไม่มี mfd_date ให้ใช้ remark แทน
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

    // SQL สำหรับเพิ่ม Lot
    const sqlInsertLot = `INSERT INTO lots (product_id, quantity, lot_batch_code, mfg_date, exp_date) VALUES (?, ?, ?, ?, ?)`;
    
    // SQL สำหรับเพิ่ม Transaction
    const sqlInsertTransaction = `INSERT INTO Transactions (product_id, employee_id, change_amount, transaction_type, transaction_date, note) VALUES (?, ?, ?, ?, ?, ?)`;

    // --- เริ่มกระบวนการบันทึกลง Database ---
    
    // รันคำสั่งที่ 1: บันทึกลงตาราง lots
    db.run(sqlInsertLot, [req.params.id, quantity, lot_number, mfd_date, exp_date], function(err) {
        if (err) {
            console.error("Error inserting lot:", err.message);
            return res.status(500).send("เกิดข้อผิดพลาดในการบันทึก Lot: " + err.message);
        }

        // ถ้ารันคำสั่งแรกสำเร็จ ให้รันคำสั่งที่ 2: บันทึกลงตาราง Transactions ต่อ
        db.run(sqlInsertTransaction, [req.params.id, req.session.user.emp_id, quantity, transaction_type, transaction_date, note], function(err2) {
            if (err2) {
                console.error("Error inserting transaction:", err2.message);
                // หมายเหตุ: ในระบบใหญ่ๆ ถ้า error ตรงนี้อาจจะต้องทำ Rollback ข้อมูล Lot แต่เบื้องต้นใช้แบบนี้ไปก่อนได้ครับ
                return res.status(500).send("เกิดข้อผิดพลาดในการบันทึก Transaction: " + err2.message);
            }

            // บันทึกสำเร็จทั้ง 2 ตาราง
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

    // 1. ตรวจสอบข้อมูล Input เบื้องต้น
    if (!product_id || isNaN(withdrawQty) || withdrawQty <= 0) {
        return res.redirect(`${backUrl}?error=invalid_quantity`);
    }

    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const transaction_date = (new Date(now - tzOffset)).toISOString().slice(0, 19).replace('T', ' ');
    const transaction_type = 'จ่ายสินค้า';

    // 2. ดึงข้อมูล Lot ของสินค้านี้ ที่มีของเหลืออยู่ โดยเรียงจากเก่าสุด (FIFO)
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

        // 3. ตรวจสอบว่าสินค้ามีพอให้เบิกหรือไม่
        const totalAvailable = lots.reduce((sum, lot) => sum + lot.quantity, 0);
        if (totalAvailable < withdrawQty) {
            return res.redirect(`${backUrl}?error=insufficient_stock`);
        }

        // 4. คำนวณการหักยอดในแต่ละ Lot (ทำใน Memory ก่อนเขียนลง DB)
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

        // 5. บันทึกลงฐานข้อมูล (ใช้ TRANSACTION ป้องกันข้อมูลพังหากเกิด Error กลางคัน)
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            // 5.1 อัปเดตตาราง Lots
            updates.forEach(update => {
                db.run(`UPDATE Lots SET quantity = ? WHERE lot_id = ?`, [update.newQty, update.lot_id], function(updateErr) {
                    if (updateErr) {
                        console.error(`Error updating Lot (lot_id: ${update.lot_id}):`, updateErr.message);
                    } else {
                        console.log(`อัปเดตสต็อก Lot lot_id ${update.lot_id} สำเร็จ: เหลือยอด ${update.newQty}`);
                    }
                });
            });

            // 5.2 บันทึกประวัติลงตาราง Transactions
            const finalNote = branch_id ? `เบิกไปสาขา ${branch_id} | ${note || ''}` : (note || '');
            const sqlInsertTx = `INSERT INTO Transactions (product_id, employee_id, change_amount, transaction_type, transaction_date, destination_branch, note) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            
            db.run(sqlInsertTx, [product_id, employee_id, withdrawQty, transaction_type, transaction_date, branch_id, finalNote], function(txErr) {
                if (txErr) {
                    db.run("ROLLBACK");
                    console.error("Error inserting transaction:", txErr.message);
                    return res.redirect(`${backUrl}?error=db_error`);
                }

                // หากทุกอย่างราบรื่น ยืนยันการบันทึก (COMMIT)
                db.run("COMMIT", (commitErr) => {
                    if (commitErr) {
                        console.error("Commit error:", commitErr);
                        return res.redirect(`${backUrl}?error=db_error`);
                    }
                    
                    // เสร็จสมบูรณ์
                    res.redirect(`${backUrl}?error=success`);
                });
            });
        });
    });
});
// scan
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
// ==========================================
// แจ้งเตือน (Notifications)" ตรงกระดิ่งในหน้า mainpage.ejs
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
        // ส่งข้อมูลไปยังไฟล์ expiry.ejs
        res.render("expiry", { expiringProducts: rows, user: req.session.user });
    });
});

app.get('/api/brands', isAuthenticated, authorizeRoles(['Manager', 'Staff']), (req, res) => {
    db.all(`SELECT * FROM Brands ORDER BY brand_name`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
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

app.delete('/api/brands/:id', isAuthenticated, authorizeRoles(['Manager']), (req, res) => {
    db.run(`DELETE FROM Brands WHERE brand_id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'ไม่พบแบรนด์นี้' });
        app.locals.brands = (app.locals.brands || []).filter(b => b.brand_id != req.params.id);
        res.json({ success: true });
    });
});

// --- Categories ---
app.get('/api/categories', isAuthenticated, authorizeRoles(['Manager', 'Staff']), (req, res) => {
    db.all(`SELECT * FROM Categories ORDER BY category_name`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
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

app.delete('/api/categories/:id', isAuthenticated, authorizeRoles(['Manager']), (req, res) => {
    db.run(`DELETE FROM Categories WHERE category_id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'ไม่พบประเภทสินค้านี้' });
        app.locals.categories = (app.locals.categories || []).filter(c => c.category_id != req.params.id);
        res.json({ success: true });
    });
});

// --- Suppliers ---
app.get('/api/suppliers', isAuthenticated, authorizeRoles(['Manager', 'Staff']), (req, res) => {
    db.all(`SELECT * FROM Suppliers ORDER BY supplier_name`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
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

app.delete('/api/suppliers/:id', isAuthenticated, authorizeRoles(['Manager']), (req, res) => {
    db.run(`DELETE FROM Suppliers WHERE supplier_id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'ไม่พบซัพพลายเออร์นี้' });
        app.locals.suppliers = (app.locals.suppliers || []).filter(s => s.supplier_id != req.params.id);
        res.json({ success: true });
    });
});
// ==========================================

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});