REVISI FIREBASE CLEAN - SISTEM MONITORING STAMPING BOX

Isi revisi utama:
1. Web dashboard tidak lagi menghitung runtime/downtime sendiri.
   Runtime, downtime, machine_status, operation_count, cycle_time, good/ng/total hanya dihitung dan dikirim ESP32.

2. Struktur Firebase dirapikan:
   - stamping_box/latest              = data real-time terakhir
   - stamping_box/settings            = warning_threshold, critical_threshold, minimum_sample
   - stamping_box/control             = command dari dashboard ke ESP32
   - stamping_box/detection_inbox     = hasil deteksi baru dari Raspberry Pi
   - stamping_box/history/DD-MM-YYYY/product_000001 = histori produk harian rapi
   - stamping_box/daily_report/DD-MM-YYYY = rekap harian
   - stamping_box/logs/DD-MM-YYYY/kategori/prefix_000001 = log aktivitas sistem rapi

3. History tidak pakai push ID random untuk produk.
   ESP32 sekarang mengirim:
   history/31-05-2026/product_000001
   history/31-05-2026/product_000002
   history/31-05-2026/product_000003

4. Default machine_status dari ESP32 adalah STOP.
   Jika di Firebase masih RUN, upload file .ino revisi ke ESP32 lalu reset/restart ESP32.

5. Halaman histori diperbaiki:
   - Jumlah Mesin Beroperasi membaca operation_count dari daily_report/latest.
   - Runtime dan downtime membaca dari daily_report/latest.
   - Tabel histori membaca history/tanggal/product_xxxxxx.
   - Filter jam tetap aktif walaupun data Firebase refresh.
   - Jika filter aktif, tabel, grafik, warning/critical, dan ringkasan laporan mengikuti rentang jam yang dipilih.

6. Dashboard:
   - Grafik diberi judul Live Production Performance.
   - Logika grafik tetap waktu proses per produk dengan satuan sec/unit.
   - Tombol hanya mengirim command ke stamping_box/control.
   - Dashboard tidak lagi menulis status_machine, runtime, downtime, atau jumlah mesin beroperasi.
   - Tombol MASTER ON tetap memakai command MASTER_ON.

7. Logs juga sudah dirapikan seperti histori:
   - logs/31-05-2026/login/login_000001
   - logs/31-05-2026/command/command_000001
   - logs/31-05-2026/settings/setting_000001
   - logs/31-05-2026/emergency/emergency_000001
   Web dan ESP32 tidak lagi membuat push ID random untuk log baru.

CARA PAKAI:
1. Upload seluruh isi folder web ini ke Netlify.
2. Upload file ESP32_Stamping_Box_Master_ON_CycleTime.ino ke ESP32-S3 lewat Arduino IDE.
3. Setelah ESP32 menyala dan konek WiFi, ESP32 akan membuat ulang struktur latest/settings/control/daily_report di Firebase.
4. Untuk Raspberry Pi, lebih rapi jika hasil deteksi dikirim ke stamping_box/detection_inbox.
   Tetapi ESP32 masih diberi fallback untuk membaca stamping_box/incoming_result agar source Raspberry Pi lama tidak langsung putus.

CATATAN:
- Data lama di Firebase dengan nama lama tidak otomatis terhapus semua, tetapi latest akan ditimpa oleh format baru setelah ESP32 online.
- Untuk tampilan paling bersih, hapus node history/logs lama yang masih berupa push ID random setelah backup.
