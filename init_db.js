const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('Warehouse.db');

db.serialize(() => {
    // สร้างตารางตาม ER Diagram
    db.run(`CREATE TABLE IF NOT EXISTS Employees (
        employee_id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name VARCHAR(255),
        last_name VARCHAR(255)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS Users (
        user_id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(255) UNIQUE,
        password VARCHAR(255),
        employee_id INTEGER,
        status VARCHAR(20) DEFAULT 'Active',
        FOREIGN KEY (employee_id) REFERENCES Employees(employee_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS Products (
        sku VARCHAR(255) PRIMARY KEY,
        product_name VARCHAR(255) NOT NULL,
        quantity_total INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS Lots (
        lot_id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku VARCHAR(255),
        lot_batch_code VARCHAR(255),
        exp_date DATE,
        quantity INTEGER,
        FOREIGN KEY (sku) REFERENCES Products(sku)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS Transactions (
        trans_id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku VARCHAR(255),
        user_id INTEGER,
        change_amount INTEGER,
        trans_type VARCHAR(50),
        trans_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sku) REFERENCES Products(sku),
        FOREIGN KEY (user_id) REFERENCES Users(user_id)
    )`);

    console.log("Database 'Warehouse.db' created with tables successfully!");
});
db.close();