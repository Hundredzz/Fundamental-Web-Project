const popup = document.getElementById('detailPopup');
    const closeBtn = document.getElementById('closePopupBtn');
    const info = document.getElementById('info-container');


    function showDetail(btnElement){
         // 1. Get the ID from the button we clicked
            const productId = btnElement.getAttribute('data');
            
            // 2. Open the popup right away so the user sees it reacting
            popup.classList.add('active');
            document.getElementById('popupTitle').innerText = "Loading...";

            // 3. Fetch the data from our index.js backend
            fetch(`/api/product/${productId}`)
                .then(response => response.json())
                .then(data => {
                    const infoData = ["รหัสสินค้า : " + data.product_id, "ชื่อสินค้า : " + data.product_name, "แบรนด์ : " + data.brand_name,  "ประเภท : " + data.category_name, "ซัพพลายเออร์ : " + data.supplier_name, "ปริมาณสุทธิ : " + data.net_content, "ราคาทุน : " + data.cost_price, "ราคาขาย : " + data.selling_price, "เลขที่จดแจ้ง : " + data.fda_number];
                    // 4. Put the data into the pop-up
                    document.getElementById('popupImage').src = `/img/product_image/${data.img_path}`;
                    document.getElementById('popupTitle').innerText = 'ข้อมูลสินค้า';
                    infoData.forEach(item => {
                        const p = document.createElement('p');
                        const textNode = document.createTextNode(item);
                        p.appendChild(textNode);
                        info.appendChild(p);
                    });
                })
                .catch(error => {
                    console.error('Error fetching product:', error);
                    document.getElementById('popupTitle').innerText = "Error loading details.";
                });
    }

    // Close button logic
    closeBtn.addEventListener('click', () => {
        popup.classList.remove('active');
        info.innerHTML = '';
    });

    // Close if clicking outside the box
    window.addEventListener('click', (event) => {
        if (event.target === popup) {
            popup.classList.remove('active');
            info.innerHTML = '';
        }
    });