function deleteProduct(productId) {
    // 1. Show the confirmation popup
    if (confirm('คุณแน่ใจหรือไม่ว่าต้องการลบสินค้านี้? ข้อมูลและรูปภาพจะถูกลบถาวร')) {
        
        // 2. Send the proper DELETE request
        fetch(`/delete-product/${productId}`, {
            method: 'DELETE'
        })
        .then(response => {
            if (response.ok) {
                // 3. If the server says OK, refresh the page to show the product is gone
                window.location.reload(); 
            } else {
                alert('เกิดข้อผิดพลาดในการลบสินค้า');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
        });
    }
}