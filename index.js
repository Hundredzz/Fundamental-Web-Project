const express = require("express");
const crypto = require("crypto");
const { title } = require("process");
const port = 3000;
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const cookieParser = require("cookie-parser");
const multer = require('multer');

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
        cb(null, Date.now() + path.extname(file.originalname));
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
    res.render("manage");
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
            res.render('editProduct', { product: data, title: 'แก้ไขสินค้า', brands: global_brands, categories: global_categories, suppliers:global_supplier });
        })
        .catch(error => {
            console.error('Error loading page:', error);
        })
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
    
    // 1. Extract all the text fields from the form (req.body)
    // The names here exactly match the name="..." attributes in your HTML
    const { 
        code,           // product_id
        name,           // product_name
        brand,          // brand_id
        category,       // category_id
        supplier,       // supplier_id
        net_content, 
        cost_price, 
        selling_price, 
        fda_no 
    } = req.body;

    let sql;
    let params;

    // 2. Check if a new file was uploaded
    if (req.file) {
        // SCENARIO A: They uploaded a NEW image.
        // We include 'img_path = ?' in the SQL query to update the image.
        const newImagePath = req.file.filename;

        sql = `
            UPDATE Products 
            SET 
                product_name = ?, 
                brand_id = ?, 
                category_id = ?, 
                supplier_id = ?, 
                net_content = ?, 
                cost_price = ?, 
                selling_price = ?, 
                fda_number = ?, 
                img_path = ?       -- <--- Updating the image path
            WHERE product_id = ?
        `;
        
        // The order of these params MUST match the order of the '?' in the SQL above
        params = [name, brand, category, supplier, net_content, cost_price, selling_price, fda_no, newImagePath, code];

    } else {
        // SCENARIO B: They did NOT upload a new image.
        // We leave 'img_path' completely out of the SQL query so the old image stays safe in the database.
        
        sql = `
            UPDATE Products 
            SET 
                product_name = ?, 
                brand_id = ?, 
                category_id = ?, 
                supplier_id = ?, 
                net_content = ?, 
                cost_price = ?, 
                selling_price = ?, 
                fda_number = ?
            WHERE product_id = ?
        `;
        
        params = [name, brand, category, supplier, net_content, cost_price, selling_price, fda_no, code];
    }

    // 3. Execute the database update
    db.run(sql, params, function(err) {
        if (err) {
            console.error("Database Update Error:", err.message);
            return res.status(500).send("เกิดข้อผิดพลาดในการบันทึกข้อมูลสินค้า");
        }

        console.log(`Product ${code} successfully updated!`);
        
        // 4. Redirect the user after a successful save
        // Usually, you send them back to the product list or dashboard
        res.redirect("/product"); 
    });
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
