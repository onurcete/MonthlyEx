# MonthlyEx

Kredi kartı harcamalarını tek bir aylık görünümde takip eden, önce yerelde çalışan Next.js uygulaması.

## Başlatma

Node.js 22.13 veya üzeri gerekir.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Tarayıcıda http://127.0.0.1:3000 adresini açın. API anahtarı veya bulut hesabı bu sürümde gerekmez.

## İlk sürümde çalışanlar

- Kart adı ve son dört hane ile kart ekleme.
- TRY cinsinden manuel harcama / iade kaydı ve kayıt silme.
- Ay seçimi, kategori filtresi, iş yeri araması ve kategori dağılımı.
- Net harcama, toplam harcama ve iade hesapları. Tutarlar kuruş cinsinden tam sayı saklanır.
- PDF, JPEG, PNG ve WebP dosyalarını yerel arşive yükleme (20 MB sınırı).
- Dosya özeti ile aynı belgenin tekrar yüklenmesini engelleme.

**Otomatik PDF/fotoğraf okuma, OCR, AI kategorilendirme, taksit ayrıştırma ve banka formatları henüz uygulanmadı.** Yüklenen belgeler analiz bekler; harcama kayıtlarını otomatik oluşturmaz. Örnek veya uydurma harcama verisi eklenmez.

## Verilerin yeri

- Veritabanı: `data/monthlyex.db` (SQLite / libSQL).
- Ekstreler: `data/statements/` (uygulama içinde üretilmiş dosya kimlikleriyle).
- `data/`, `.env.local`, günlükler ve bağımlılıklar Git tarafından yok sayılır.
- Yedek almak için sunucuyu durdurup `data/` klasörünün tamamını kopyalayın.
- Dosyalar yerel diskte şifrelenmeden saklanır; işletim sistemi kullanıcı erişim izinleri geçerlidir.

## Kontroller

```powershell
npm run build
npm run typecheck
```

## Vercel'e geçiş

Kod Next.js App Router ve Node.js route handlers kullanır. Yerel sunucu varsayılan olarak yalnızca `127.0.0.1` adresinde dinler. Henüz internete açık kullanım için kimlik doğrulama bulunmaz.

Yayınlamadan önce:

1. Kullanıcı girişi, yetkilendirme ve kullanıcıya ait kayıt ayrımını ekleyin.
2. Yerel SQLite yerine kalıcı uzak libSQL veritabanını `DATABASE_URL` ve `DATABASE_AUTH_TOKEN` ile bağlayın. PostgreSQL seçilirse veri erişim katmanı uyarlanmalıdır.
3. Ekstre dosyaları için özel nesne depolaması ve doğrudan yükleme akışı ekleyin. Dosya erişimi kullanıcıya özel olmalı.
4. Belge analizini sunucu tarafındaki OpenAI entegrasyonuna bağlayın; iş durumu, doğrulama, maliyet kaydı ve tekrar deneme mekanizması ekleyin.
5. Kaynak belge / sayfa referanslarıyla kontrol ekranı, taksit / ödeme / iade ayrımı ve işlem düzeyinde mükerrer kayıt kontrolü ekleyin.

Vercel ortamında yerel dosya depolamasına yazma engellenir; uzak veritabanı verilmezse veritabanı katmanı açık hata üretir. Bu, yayınlanan sürümde kalıcı olmayan yerel diske kayıt yapılmasını önler. Bu başlangıç sürümü doğrudan üretime açılmamalıdır.

## Yapı

- `src/components/dashboard.tsx`: Türkçe arayüz ve yerel API istemcisi.
- `src/lib/db.ts`: Veritabanı ve ilk şema.
- `src/app/api/records/route.ts`: Kart / işlem ekleme ve işlem silme.
- `src/app/api/statements/route.ts`: Yerel belge arşivi.
- `src/app/api/data/route.ts`: Kayıtları okuma.

Git deposuna ekstreleri veya API anahtarlarını eklemeyin.
