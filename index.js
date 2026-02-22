const express = require("express");
const path = require("path");
const crypto = require("crypto");
const port = 3000;
const sqlite3 = require('sqlite3').verbose();

// Creating the Express server
const app = express();

// Connect to SQLite database
let db = new sqlite3.Database('Warehouse.db', (err) => {    
  if (err) {
      return console.error(err.message);
  }
  console.log('Connected to the SQlite database.');
});


// static resourse & templating engine
app.use(express.static('public'));
// Set EJS as templating engine
app.set('view engine', 'ejs');

app.use(express.json())
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
    let errorMessage = null;

    // ตรวจสอบว่ามี error ส่งมาทาง URL หรือไม่
    if (req.query.error === "notfound") {
        errorMessage = "ไม่พบบัญชีผู้ใช้งาน หรืออีเมลนี้ในระบบ";
    } else if (req.query.error === "inactive") {
        errorMessage = "บัญชีนี้ถูกระงับการใช้งาน";
    } else if (req.query.error === "wrongpassword") {
        errorMessage = "รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง";
    }

    res.render("login", { error: errorMessage });
});

app.post("/login", (req, res) => {
    const {username, password} = req.body;

    const sql = `SELECT Users.password, Users.status
        FROM Users 
        INNER JOIN Employees ON Users.employee_id = Employees.employee_id 
        WHERE Users.username = ? OR Employees.email = ?`;

    // 1. Find the user in the database
    db.get(sql, [username, username], (err, row) => {
        if (err) return res.status(500).send(err.message);
        
        if (!row) {
            // แก้ไขตรงนี้: ชี้กลับไปที่หน้าหลัก (/) พร้อมส่ง query string
            return res.redirect("/?error=notfound");
        }
        
        if (row.status === "Inactive") {
            // เพิ่มการจัดการสถานะ Inactive
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
                res.send("Login successful!");
            } else {
                // แก้ไขตรงนี้: ถ้ารหัสผิด ให้ redirect กลับไปหน้าแรกเช่นกัน
                res.redirect("/?error=wrongpassword");
            }
        });
    });
});

app.post("/add", (req, res) => {
    const {username, password} = req.body;

    // 1. Generate a random 16-byte salt
    const salt = crypto.randomBytes(16).toString("hex");

    // 2. Hash the password with the salt using scrypt
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
        if (err) return res.status(500).send("Hashing error");

        // 3. Convert the hash to a string and combine it with the salt
        const hash = derivedKey.toString("hex");
        const passwordToSave = `${salt}:${hash}`; // Format: "salt_string:hash_string"

        // 4. Save to SQLite database
        db.run(`INSERT INTO Users (username, password, role) VALUES (?, ?, ?)`, [username, passwordToSave, "Staff"], function(err) {
            if (err) return console.error(err.message);
            res.send("User registered securely without bcrypt!");
        });
    });
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});