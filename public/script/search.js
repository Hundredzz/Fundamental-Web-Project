function search(fetchUrl) {
                
                const tableBody = document.getElementById('table');

                
                const form = document.getElementById('search-form');

                
                
                const params = new URLSearchParams(new FormData(form));

                let fullFetchUrl = `${fetchUrl}?${params.toString()}`;

                
                tableBody.style.opacity = '0.5';

                
                fetch(fullFetchUrl)
                    .then(response => response.json())
                    .then(data => {
                        tableBody.innerHTML = data.html;
                        document.querySelector('.table-scroll-container').scrollTo({ top: 0 });
                    })
                    .catch(error => {
                        console.error('Error loading users:', error);
                        alert('เกิดข้อผิดพลาดในการค้นหา');
                    })
                    .finally(() => {
                        tableBody.style.opacity = '1';
                    });
            }