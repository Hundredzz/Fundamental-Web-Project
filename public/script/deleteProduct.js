const cPopup = document.getElementById('confirmPopup');
function deleteProduct(productId) {
        
        
        fetch(`/delete-product/${productId}`, {
            method: 'DELETE'
        })
        .then(response => {
            if (response.ok) {
                
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

    
    cPopup.classList.add('active');

}

function closePopUp() {
    cPopup.classList.remove('active');
    cPopup.innerHTML = '';
}


window.addEventListener('click', (event) => {
    if (event.target === cPopup) {
        cPopup.classList.remove('active');
        cPopup.innerHTML = '';
    }
});