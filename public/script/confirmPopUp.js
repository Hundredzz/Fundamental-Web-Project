const popup = document.getElementById('confirmPopup');
const closeBtn = document.getElementById('closePopupBtn');


function showDetail(title, data, path) {

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

    // 2. Open the popup right away so the user sees it reacting
    popup.classList.add('active');

}

// Close button logic
function closePopUp() {
    popup.classList.remove('active');
    popup.innerHTML = '';
}

// Close if clicking outside the box
window.addEventListener('click', (event) => {
    if (event.target === popup) {
        popup.classList.remove('active');
        popup.innerHTML = '';
    }
});