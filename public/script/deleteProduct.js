const cPopup = document.getElementById('confirmPopup');
function deleteProduct(productId) {
        
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

function confirmDetail(title, data, path) {

    cPopup.innerHTML = `
        <div class="popup-content">
            <h3>${title}</h3>
            <h1 style="color: #75162E;">${data}</h1>
            <div class="bt-con-popup">
                <button class="bt-popup-no" onclick="closePopUp()">ไม่</button>
                
                <button class="bt-popup-yes" onclick="deleteProduct('${path}')">ใช่</button>
            </div>
        </div>
    `;

    // 2. Open the popup right away so the user sees it reacting
    cPopup.classList.add('active');

}

function closePopUp() {
    cPopup.classList.remove('active');
    cPopup.innerHTML = '';
}

// Close if clicking outside the box
window.addEventListener('click', (event) => {
    if (event.target === cPopup) {
        cPopup.classList.remove('active');
        cPopup.innerHTML = '';
    }
});