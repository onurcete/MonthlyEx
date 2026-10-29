# MonthlyEx

Kredi kartı harcamalarını tek bir aylık görünümde takip eden, önce yerelde çalışan Next.js uygulaması.

## Başlatma

Node.js 22.13 veya üzeri gerekir.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Tarayıcıda http://127.0.0.1:3000 adresini açın. Manuel kayıt ve belge arşivi API anahtarı olmadan çalışır; AI analizi için aşağıdaki ayar gerekir.

## OpenAI ile ekstre analizi

Mevcut `.env.local` dosyanıza aşağıdaki alanları ekleyin; mevcut veritabanı ayarlarınızı koruyun:

```dotenv
OPENAI_API_KEY=buraya_kendi_api_anahtarinizi_yazin
OPENAI_MODEL=gpt-4.1
```

Geliştirme sunucusunu yeniden başlatın. Anahtarı tarayıcıya, sohbet alanına veya `NEXT_PUBLIC_` değişkenlerine koymayın.

1. Ekstreler ekranında daha önce yüklediğiniz belgenin yanındaki **AI ile analiz et** düğmesine basın. Belgeyi tekrar yüklemeniz gerekmez.
2. Belge OpenAI Responses API'ye gönderilir. PDF için metin ve sayfa görüntüleri, fotoğraflar için görsel girdi kullanılır. API kullanımı hesabınıza ücret yansıtabilir.
3. Türkçe özeti, ekstre bilgilerini, uyarıları ve kaynak sayfa numaralı işlem listesini inceleyin. Kaynak belgeyi ayrı sekmede açabilirsiniz.
4. Hedef kartı seçin; tarih, iş yeri, tutar, kategori ve işlem türünü gerektiğinde düzeltin. Tutar alanında `1250,50` biçimini kullanın.
5. **Ekstrenin ait olduğu ay** alanını kontrol edin. Ay hesap kesim tarihinden önerilir; değiştirebilirsiniz. **Kontrol ettim, seçilenleri kaydet** ile işlemleri aktarın.

Genel bakış, aylık grafikler ve işlem listesinin ay filtresi **ekstre ayını** esas alır. Örneğin 25 Eylül–25 Ekim ekstresindeki tüm harcamalar ve iadeler Ekim’e yazılır; gerçek işlem tarihleri korunur. Günlük grafik gerçek tarihleri gösterir; Eylül ve Ekim’in aynı numaralı günleri birleştirilmez. Manuel işlemlerde işlem tarihinin ayı kullanılır.

Kaydedilmiş ekstreyi **Görüntüle / düzenle** ile açıp ekstre ayını değiştirmek tüm bağlı işlemleri yeni aya taşır; mükerrer kayıt oluşturmaz. Önceden yüklenmiş belgeler için mevcut analizdeki hesap kesim tarihinden ay otomatik tamamlanır. Tarih bulunamazsa işlemler yanlış aya dağıtılmaz; ekstre ayı seçilene kadar aylık analiz dışında tutulur ve genel bakışta uyarı gösterilir.

Ekstre listesindeki çöp kutusu düğmesi belgeyi, analiz sonucunu ve bu belgeden aktarılmış tüm işlemleri birlikte siler. Aynı karta ait manuel işlemler ve diğer ekstrelerin işlemleri korunur. İşlem öncesi arayüzde onay istenir; aktif analiz sürerken silme engellenir.

PDF sayfaları `detail: high` ile gönderilir. İş yeri açıklaması belgede yazıldığı haliyle istenir; her işlem için okunan ham tutar da saklanır ve inceleme tablosunda gösterilir. Türkçe tutar metni kuruşa kodla çevrilir; modelin sayısal değeriyle uyuşmazlık veya belirsiz biçim varsa satır kontrol için işaretlenir. Bu, modelin yanlış satırı veya rakamı okumasını tek başına engellemez.

`OPENAI_MODEL` değişikliği yalnızca yeni analizlere uygulanır; önceden kaydedilmiş sonuçlar yenilenmez. Daha güçlü bir modelle karşılaştırma için örneğin `gpt-5.4` kullanılabilir; erişim ve ücret hesabınıza bağlıdır. Mevcut ekstreyi silip tekrar yüklemek bağlı işlemleri de siler, ardından yeni modelle analiz yapılabilir. Modeller arasında bu belgeler üzerinde doğruluk karşılaştırması henüz yapılmadı.

Belirsiz satırlar başlangıçta seçilmez. Kart borcu ödemeleri ve TL karşılığı bulunmayan döviz satırları aktarılmaz. Ücretler ve faizler harcama olarak aktarılır; taksitlerde yalnızca döneme yansıyan tutar kullanılır. Taksit metni ve kaynak sayfa bağlantısı veritabanında saklanır; gelecek dönem taksit planı oluşturulmaz.

Bir belgenin ikinci kez aktarılması engellenir. Farklı belgelerde tekrarlanan hareketler otomatik eşleştirilmez; inceleme sırasında bunların seçimini kaldırın. AI çıkarımı hata yapabilir ve bu sürümde ekstre borcuyla otomatik muhasebe mutabakatı yapılmaz. Dönem borcu ile yeni harcama toplamı farklı olabilir.

Analiz birkaç dakika sürebilir. Başarısız analiz tekrar denenebilir; sunucu kesintisinden sonra kilit 5 dakika içinde yenilenebilir. Tamamlanan sonuçlar saklanır, tekrar görüntüleme API çağrısı yapmaz. Model ve token kullanım bilgisi yerel veritabanında tutulur. İsteklerde `store: false` kullanılır; bu ayar OpenAI'nin tüm hizmet günlüklerinin tutulmadığı anlamına gelmez.

Teknik kaynaklar: [OpenAI dosya girdileri](https://developers.openai.com/api/docs/guides/file-inputs), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## İlk sürümde çalışanlar

- Kart adı ve son dört hane ile kart ekleme.
- TRY cinsinden manuel harcama / iade kaydı ve kayıt silme.
- Ay seçimi, kategori filtresi, iş yeri araması ve kategori dağılımı.
- Net harcama, toplam harcama ve iade hesapları. Tutarlar kuruş cinsinden tam sayı saklanır.
- PDF, JPEG, PNG ve WebP dosyalarını yerel arşive yükleme (20 MB sınırı).
- Dosya özeti ile aynı belgenin tekrar yüklenmesini engelleme.

- OpenAI API ile PDF/fotoğraf analizi, kategori önerisi, harcama / iade / ödeme / faiz / ücret ayrımı.
- Düzenlenebilir inceleme ekranı ve tek seferlik, atomik aktarım.
- Analiz durumu, hata mesajları, yeniden deneme ve kaynak belge görüntüleme.

## Kategoriler ve kategori grafikleri

Başlangıç tanımları 10 ana kategori ve 37 alt kategoriden oluşur. Kategoriler ekranından adlarını düzenleyebilir veya yeni kategori ekleyebilirsiniz. Ekstre tablosunda kategori alanına tıklamak; ana ve alt kategorileri birlikte gösteren, arama yapılabilen tek bir pencere açar. Ana kategoriyi seçip sağ taraftan alt kategoriyi seçin; alt kırılım gerekmiyorsa yalnızca ana kategoriye kaydedebilirsiniz. Aynı seçim penceresi manuel işlem formunda da kullanılır.

Yeni tanımlar ilk açılışta mevcut veritabanına bir kez uygulanır. Eski kategori bağlantıları korunarak taşınır; aynı isimli kategori ve alt kategoriler birleştirilir. Önceden “Eğitim” olarak kaydedilen hareketler “Diğer”e taşınır; “Eğlence & Hobiler” olarak yorumlanmaz. Daha önce eklediğiniz özel kategoriler korunur. Sonraki açılışlar kişisel kategori düzenlemelerini sıfırlamaz. Eski ana kategorideki hareketlere alt kategori tahmin edilmez; gerektiğinde ekstre düzenleme ekranından seçebilirsiniz.

Genel bakıştaki **Kategori analizi** bölümünde **Seçili ay** veya **Ay aralığı** seçin. Başlangıç ve bitiş ayları dahildir. Ana ya da alt kategori filtresiyle harcama, iade veya net harcama karşılaştırılabilir. Ana kategori toplamı tüm alt kategorilerini içerir. Kategori karşılaştırması ve aylık sütun grafiği ekstre ayını esas alır; işlem tarihi farklı aya denk gelse de kayma olmaz. Net değer negatifse iadeler harcamayı aşmıştır. Bu panelin ay aralığı, genel bakışın diğer bölümlerindeki seçili ayı değiştirmez.

## Kategori seçimlerinden öğrenme

Ekstre incelemesinde ana/alt kategori seçimini değiştirdiğinizde **Bu iş yeri için hatırla** otomatik işaretlenir. İşlemleri kaydettiğinizde seçim yerel veritabanında öğrenme örneği olarak saklanır. İsterseniz AI'nin önerdiği kategoriyi de bu kutuyla açıkça onaylayabilirsiniz. İşaretlenmemiş AI önerileri öğrenme verisine dönüştürülmez. Manuel eklediğiniz işlemlerde kategori sizin seçiminiz olduğu için otomatik hatırlanır.

Sonraki analizlerde iş yeri adı büyük/küçük harf, Türkçe harf ve noktalama farkları giderilerek karşılaştırılır. Şube kodları, sayılar ve ödeme aracısı adları korunur; benzer görünen farklı iş yerleri bulanık eşleştirmeyle birleştirilmez. Tek bir kategoriye ait geçmiş seçim varsa kategori ve alt kategori otomatik uygulanır ve **Önceki seçiminden öğrenildi** etiketi görünür. Birden fazla farklı kategori seçimi varsa AI önerisi korunur, satır kontrol için işaretlenir. Öğrenme tutar/tarih belirsizliği uyarılarını kaldırmaz; yeni kayıtta inceleme adımı devam eder.

Kaydedilmiş ekstreyi düzenlerken seçimi değiştirmek aynı öğrenme örneğini günceller, tekrar örnek oluşturmaz. **Bu iş yeri için hatırla** işaretini kaldırıp kaydetmek o işlemin öğrenme örneğini siler. İşlem veya ekstre silinirse bağlı öğrenme örnekleri de kaldırılır. Diğer işlemlerden öğrenilen örnekler korunur. Kategori isimleri değişse de eşleştirmeler kategori kimliğine bağlı kaldığı için güncel ad kullanılır.

İlk açılışta eski manuel kayıtlar ve mevcut AI sonucuyla tek bir satır üzerinden güvenle karşılaştırılabilen kategori düzeltmeleri de öğrenmeye eklenir. Önceden elle değiştirilip değiştirilmediği belirlenemeyen hareketler otomatik öğrenilmez; bu hareketlerde kutuyu işaretleyip kaydedebilirsiniz. Bu aktarım bir kez yapılır; unuttuğunuz seçimler sonraki açılışta geri eklenmez.

Öğrenme yerel bir iş yeri–kategori eşleştirmesidir. Geçmiş harcamalarınız bu özellik için OpenAI'ye gönderilmez ve model eğitimi yapılmaz. Analiz bekleyen kaydedilmiş sonuçlar tekrar açıldığında güncel eşleştirmeler API çağrısı olmadan uygulanır; aktarılmış geçmiş işlemler otomatik değiştirilmez.

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
npm test
```

## Vercel'e geçiş

Kod Next.js App Router ve Node.js route handlers kullanır. Yerel sunucu varsayılan olarak yalnızca `127.0.0.1` adresinde dinler. Henüz internete açık kullanım için kimlik doğrulama bulunmaz.

Yayınlamadan önce:

1. Kullanıcı girişi, yetkilendirme ve kullanıcıya ait kayıt ayrımını ekleyin.
2. Yerel SQLite yerine kalıcı uzak libSQL veritabanını `DATABASE_URL` ve `DATABASE_AUTH_TOKEN` ile bağlayın. PostgreSQL seçilirse veri erişim katmanı uyarlanmalıdır.
3. Ekstre dosyaları için özel nesne depolaması ve doğrudan yükleme akışı ekleyin. Dosya erişimi kullanıcıya özel olmalı.
4. Uzun analizler için kalıcı arka plan işleri ve maliyet sınırları ekleyin; analiz ve belge okuma katmanını uzak dosya depolamasına bağlayın.
5. Farklı belgeler arasında işlem düzeyinde mükerrer kayıt kontrolü ve toplam mutabakatını ekleyin.

Vercel ortamında yerel dosya depolamasına yazma engellenir; uzak veritabanı verilmezse veritabanı katmanı açık hata üretir. Bu, yayınlanan sürümde kalıcı olmayan yerel diske kayıt yapılmasını önler. Bu başlangıç sürümü doğrudan üretime açılmamalıdır.

## Yapı

- `src/components/dashboard.tsx`: Türkçe arayüz ve yerel API istemcisi.
- `src/components/statements.tsx`: Belge yükleme, AI analizi ve işlem inceleme ekranı.
- `src/lib/openai-analysis.ts`: Sunucu tarafında OpenAI Responses API çağrısı.
- `src/lib/analysis-schema.ts`: Yapılandırılmış analiz çıktısı ve doğrulama.
- `src/lib/db.ts`: Veritabanı ve ilk şema.
- `src/app/api/records/route.ts`: Kart / işlem ekleme ve işlem silme.
- `src/app/api/statements/route.ts`: Yerel belge arşivi.
- `src/app/api/data/route.ts`: Kayıtları okuma.

Git deposuna ekstreleri veya API anahtarlarını eklemeyin.
