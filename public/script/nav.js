const toggleBtn = document.getElementById('menu-toggle-btn');
const sideMenu = document.getElementById('side-menu');
const mainContent = document.getElementById('main-content');

function toggleMenu() {
    // Toggle the classes to open the menu and push the content
    sideMenu.classList.toggle('open');
    mainContent.classList.toggle('pushed');

    // Swap the icon depending on whether the menu is open
    if (sideMenu.classList.contains('open')) {
        toggleBtn.children[0].style.opacity = '0'; 
        toggleBtn.children[1].style.opacity = '1';
        toggleBtn.children[2].style.color = '#F2D9A3'; // Change text color when menu is open
    } else {
        toggleBtn.children[0].style.opacity = '1';
        toggleBtn.children[1].style.opacity = '0';
        toggleBtn.children[2].style.color = '#75162E'; // Change text color back when menu is closed
    }
}

// Listen for clicks on the button
toggleBtn.addEventListener('click', toggleMenu);