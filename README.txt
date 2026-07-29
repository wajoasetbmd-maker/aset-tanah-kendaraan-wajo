ASET TANAH DAN KENDARAAN — WEB V17.7 LOCAL-FIRST
=================================================

Perubahan utama:
- Dashboard, daftar, detail, dan form dibaca dari IndexedDB browser setelah cache awal tersedia.
- Saat online, aplikasi hanya memeriksa nomor revisi server. Data diunduh ulang bila revisi berubah.
- Simpan/edit/hapus kendaraan dan tanah masuk antrean lokal lalu disinkronkan bertahap.
- Surat rekomendasi dibuka langsung dari template A4 lokal; penyimpanan ke server berjalan di latar belakang.
- Format surat web mengikuti format default Google Docs: kop, nomor/perihal, identitas, rekomendasi, tanda tangan, penanggung jawab, dan tembusan.
- GPS web memakai watchPosition dan hanya menerima hasil dengan akurasi memadai.

SYARAT BACKEND:
Backend Apps Script minimal V18.3/V18.3.1 yang memiliki endpoint snapshot, master offline, sinkronisasi batch, reservasi nomor surat, dan revisi data.

PENERAPAN:
Upload dan replace seluruh isi ZIP ini ke root repository Cloudflare Pages/GitHub. Tidak perlu mengganti variabel GAS_BACKEND_URL atau GAS_API_KEY.
Setelah deployment selesai, buka aplikasi lalu lakukan hard refresh Ctrl+F5.

CATATAN:
Login pertama dan pembuatan cache pertama harus online. Jika data situs/browser dihapus, cache lokal ikut terhapus.
Sinkronisasi berjalan saat tab aplikasi aktif dan dilanjutkan ketika aplikasi dibuka kembali. Browser tidak menjamin pekerjaan JavaScript terus berjalan setelah seluruh browser ditutup.
