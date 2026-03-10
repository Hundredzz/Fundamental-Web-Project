const toggleBtn = document.getElementById('menu-toggle-btn');
const sideMenu = document.getElementById('side-menu');
const mainContent = document.getElementById('main-content');
const header = document.getElementById("web-header");

window.addEventListener("scroll", () => {
    if (sideMenu.classList.contains('open')) {
        return; 
    }
    
    if (window.scrollY > 50) {
        header.classList.add("scrolled");
    } else {
        header.classList.remove("scrolled");
    }
});

function toggleMenu() {
    
    sideMenu.classList.toggle('open');
    mainContent.classList.toggle('pushed');

    
    if (sideMenu.classList.contains('open')) {
        header.classList.remove("scrolled");
        toggleBtn.children[0].style.opacity = '0';
        toggleBtn.children[1].style.opacity = '1';
        toggleBtn.children[2].style.color = '#F2D9A3'; 
    } else {
        if (window.scrollY > 50) {
            header.classList.add("scrolled");
        }
        toggleBtn.children[0].style.opacity = '1';
        toggleBtn.children[1].style.opacity = '0';
        toggleBtn.children[2].style.color = '#75162E'; 
    }
}


toggleBtn.addEventListener('click', toggleMenu);