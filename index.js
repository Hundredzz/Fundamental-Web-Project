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

app.get("/receive", isAuthenticated, (req, res) => { 
    res.render("receive_stock");
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
app.get("/manageEdit", isAuthenticated, (req, res) => res.render("manageEdit"));
app.get("/undefind", isAuthenticated, (req, res) => res.render("undefind")); // Typo kept for your routing

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
            p.product_id, 
            p.product_name, 
            t.change_amount, 
            e.first_name || ' ' || e.last_name AS employee_name
        FROM Transactions t
        LEFT JOIN Products p ON t.product_id = p.product_id
        LEFT JOIN Employees e ON t.employee_id = e.employee_id
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
        queryParams.push(type);
    }

    // 4. กรองตามชื่อ-นามสกุลผู้ทำรายการ
    if (employee_name) {
        sql += ` AND Concat(e.first_name, ' ', e.last_name)LIKE ?`;
        queryParams.push(`%${employee_name.trim()}%`);
    }

    if (sortBy === 'date_asc') {
        sql += ` ORDER BY t.transaction_date ASC`;
    } else if (sortBy === 'type') {
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
            p.product_id, 
            p.product_name, 
            t.change_amount, 
            e.first_name || ' ' || e.last_name AS employee_name
        FROM Transactions t
        LEFT JOIN Products p ON t.product_id = p.product_id
        LEFT JOIN Employees e ON t.employee_id = e.employee_id
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
    } else if (sortBy === 'type') {
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
    csvHeader = "วันที่,ประเภทรายการ,รหัสสินค้า,ชื่อสินค้า,จำนวน,ผู้ทำรายการ\n";
    

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
                csvContent += `"${row.transaction_date}","${row.transaction_type}","${row.product_id}","${row.product_name}","${row.change_amount}","${row.employee_name}"\n`;
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

app.get("/addUser", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    res.render("addUser", { error: null });
});

app.get("/add-user", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    res.render("manageEdit", { user: null, title: 'เพิ่มผู้ใช้', path: '/add-user-data' });
});

app.post("/add-user-data", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
    const { employeeId, userName, password, fname, lname, email, phone, role } = req.body;
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
                db.run(userSql, [userName, passwordToSave, role, employeeId, status], function(userErr) {
                    if (userErr) return res.status(400).send("เกิดข้อผิดพลาด: ชื่อผู้ใช้นี้ (Username) มีคนใช้แล้ว");
                    res.redirect("/manage");
                });
            } else {
                db.serialize(() => {
                    const empSql = `INSERT INTO Employees (employee_id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?)`;
                    db.run(empSql, [employeeId, fname, lname, email, phone], function(empErr) {
                        if (empErr) return res.status(400).send("เกิดข้อผิดพลาดในการสร้างข้อมูลพนักงาน");

                        const userSql = `INSERT INTO Users (username, password, role, employee_id, status) VALUES (?, ?, ?, ?, ?)`;
                        db.run(userSql, [userName, passwordToSave, role, employeeId, status], function(userErr) {
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
                    db.run(updateUserSql, [userName, role, newPasswordToSave, targetUserId], function(userErr) {
                        if (userErr) return res.status(400).send("เกิดข้อผิดพลาด: ชื่อผู้ใช้นี้ (Username) ถูกใช้งานแล้ว");
                        res.redirect('/manage');
                    });
                });
            } else {
                const updateUserSql = `UPDATE Users SET username = ?, role = ? WHERE user_id = ?`;
                db.run(updateUserSql, [userName, role, targetUserId], function(userErr) {
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

app.get("/search/users", isAuthenticated, authorizeRoles(["Manager"]), (req, res) => {
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
        let role = (role === "ผู้จัดการ") ? "Manager" : "Staff";
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
    const dateSearch = req.query.data || ''; // Maps to <input name="data">
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
    if (dateSearch.trim() !== '') {
        // Since HTML date pickers send 'YYYY-MM-DD', we use LIKE to match it
        sql += ` AND t.transaction_date LIKE ?`; // **NOTE: Change t.transaction_date to match your DB column**
        queryParams.push(`%${dateSearch}%`); 
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
                totalPages: Math.ceil(row.count / limit),
                searchTerm: searchTerm
            });
        });
    });
});

//--------------------

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

// app.post('/save-stock', (req, res) => {
//     console.log("ข้อมูลที่รับมา:", req.body);

//     const { brand_id, quantity, lot_number, mfd_date, exp_date, supplier, remark } = req.body;
//     const sql = `INSERT INTO stock (brand_id, quantity, lot_number, mfd_date, exp_date, supplier, remark) VALUES (?, ?, ?, ?, ?, ?, ?)`;

//     db.run(sql, [brand_id, quantity, lot_number, mfd_date, exp_date, supplier, remark], function(err) {
//         if (err) {
//             console.error("SQL Error:", err.message);
//             return res.status(500).send("เกิดข้อผิดพลาด: " + err.message);
//         }
//         res.render('receive_success');
//     });
// });
app.post('/save-stock', (req, res) => {
    console.log("ข้อมูลที่รับมา:", req.body);

    const { product_id, quantity, lot_batch_code, exp_date } = req.body; 

    const sql = `INSERT INTO Lots (product_id, lot_batch_code, exp_date, quantity) VALUES (?, ?, ?, ?)`;

    db.run(sql, [product_id, quantity, lot_batch_code, exp_date], function(err) {
        if (err) {
            console.error("SQL Error:", err.message);
            return res.status(500).send("เกิดข้อผิดพลาดในการบันทึก Lot: " + err.message);
        }
        
        console.log(`เพิ่มข้อมูลลง Lots สำเร็จ ID: ${this.lastID}`);
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
// scan
app.get("/scan", isAuthenticated, (req, res) => {
    res.render("scan", { 
        user: req.session.user 
    });
});
//
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
// ==========================================


app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});