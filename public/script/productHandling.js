function changePage(btnElement, ejsName, branchId) {
    const productSection = document.getElementById('product-sect');
    
    
    const searchText = document.getElementById('search-text').value;
    const selectedCategory = document.getElementById('category-select').value;
    const selectedBrand = document.getElementById('brand-select').value;

    
    const params = new URLSearchParams();
    if (searchText) params.append('q', searchText);
    if (selectedCategory) params.append('category', selectedCategory);
    if (selectedBrand) params.append('brand', selectedBrand);
    if (branchId) params.append('branch_id', branchId);

    let fetchUrl;

    
    if (btnElement && btnElement.hasAttribute('data-page')) {
        const targetPage = btnElement.getAttribute('data-page');
        
        fetchUrl = `/fetch-product/${targetPage}/${ejsName}?${params.toString()}`; 
    } else {
        fetchUrl = `/search/${ejsName}?${params.toString()}`;
    }

    productSection.style.opacity = '0.5';

    fetch(fetchUrl)
        .then(response => response.json())
        .then(data => {
            productSection.innerHTML = data.html;
            JsBarcode(".barcode").init();
            window.scrollTo({
                top: 0
            });
        })
        .catch(error => {
            console.error('Error loading page:', error);
        })
        .finally(() => {
            productSection.style.opacity = '1';
        });
}