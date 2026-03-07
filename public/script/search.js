function search(fetchUrl) {
                // 1. Target the table body where the rows will be injected
                const tableBody = document.getElementById('table');

                // 1. Grab the entire form
                const form = document.getElementById('search-form');

                // 2. MAGIC: Automatically grab all named inputs and turn them into URL parameters!
                // This turns your form into "id=123&username=Admin&role=Staff" instantly
                const params = new URLSearchParams(new FormData(form));

                let fullFetchUrl = `${fetchUrl}?${params.toString()}`;

                // Give visual feedback that it's loading
                tableBody.style.opacity = '0.5';

                // 4. Fetch the new data
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