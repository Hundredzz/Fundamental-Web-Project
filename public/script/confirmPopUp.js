const popup = document.getElementById('confirmPopup');
const closeBtn = document.getElementById('closePopupBtn');


function confirmDetail(title, data, path) {

    popup.innerHTML = `
        <div class="popup-content">
            <h3>${title}</h3>
            <h1 style="color: #75162E;">${data}</h1>
            <div class="bt-con-popup">
                <button class="bt-popup-no" onclick="closePopUp()">ไม่</button>
                
                <button class="bt-popup-yes" onclick="window.location.href = '${path}'">ใช่</button>
            </div>
        </div>
    `;

    
    popup.classList.add('active');

}


function closePopUp() {
    popup.classList.remove('active');
    popup.innerHTML = '';
}


window.addEventListener('click', (event) => {
    if (event.target === popup) {
        popup.classList.remove('active');
        popup.innerHTML = '';
    }
});