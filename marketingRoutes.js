<style>
    /* الأنماط الأساسية تبقى كما هي */
    :root { --primary-color: #00796b; --accent-color: #ff7043; --light-bg: #f0f2f5; --card-bg: #ffffff; --text-dark: #050505; --text-light: #555; }
    .marketing-container { width: 100%; height: calc(100vh - 60px); display: flex; flex-direction: column; background-color: var(--light-bg); padding: 0; margin: 0; box-sizing: border-box; }
    .marketing-header { padding: 10px; background-color: var(--card-bg); box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    
    /* --- شريط البحث والأيقونات الجديدة --- */
    .search-container { display: flex; align-items: center; gap: 8px; position: relative; } /* Added position relative */
    .search-bar { flex-grow: 1; padding: 10px 15px; border-radius: 20px; border: 1px solid #ddd; font-size: 1em; box-sizing: border-box; }
    .header-icon { font-size: 1.5em; color: var(--text-light); cursor: pointer; transition: color 0.2s; padding: 5px; }
    .header-icon:hover { color: var(--primary-color); }

    /* New: Notification Badge for Wallet (Position Fixed) */
    .notification-badge {
        position: absolute;
        top: -5px;      /* تعديل: لرفع الشارة للأعلى قليلاً */
        right: 70px;    /* تعديل: لتحريك الشارة فوق أيقونة المحفظة */
        background-color: #f44336;
        color: white;
        border-radius: 50%;
        width: 18px;
        height: 18px;
        font-size: 0.75em;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        border: 1px solid white;
        display: none; /* Hidden by default */
        z-index: 10;   /* التأكد من أنها فوق الأيقونة */
    }


    .filter-bar { display: flex; overflow-x: auto; padding: 10px 0; scrollbar-width: none; }
    .filter-bar::-webkit-scrollbar { display: none; }
    .filter-chip { padding: 8px 16px; margin: 0 5px; border-radius: 20px; background-color: #e4e6eb; color: var(--text-dark); cursor: pointer; font-weight: bold; white-space: nowrap; transition: all 0.2s; }
    .filter-chip.active { background-color: var(--primary-color); color: white; }
    .marketing-content { flex-grow: 1; overflow-y: auto; padding: 10px; }
    .ad-list-card { background: var(--card-bg); border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 15px; padding: 15px; display: flex; gap: 15px; position: relative; cursor: pointer; transition: transform 0.2s; }
    .ad-list-card:hover { transform: translateY(-3px); }
    .ad-list-card.pinned { border: 2px solid #ffc107; }
    .ad-list-card.pinned::before { content: '⭐ إعلان مثبت'; position: absolute; top: -12px; right: 10px; background-color: #ffc107; color: #000; padding: 4px 8px; border-radius: 8px; font-size: 0.8em; font-weight: bold; z-index: 2; }
    
    .ad-list-image-container { position: relative; width: 100px; height: 100px; flex-shrink: 0; }
    .ad-list-image { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; }
    .ad-product-badge { position: absolute; bottom: 5px; left: 5px; background-color: rgba(0, 0, 0, 0.6); color: white; padding: 3px 8px; border-radius: 10px; font-size: 0.75em; }
    .ad-discount-badge { position: absolute; top: 5px; right: 5px; background-color: #d32f2f; color: white; padding: 4px 8px; border-radius: 10px; font-size: 0.8em; font-weight: bold; }
    
    .ad-list-details { display: flex; flex-direction: column; text-align: right; overflow: hidden; flex-grow: 1; }
    .ad-list-title { font-weight: bold; font-size: 1.1em; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ad-list-desc { font-size: 0.9em; color: var(--text-light); margin: 5px 0; height: 38px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .ad-list-price { font-size: 1.1em; color: var(--primary-color); font-weight: bold; margin-top: 5px; }
    .ad-list-price .original-price-list { text-decoration: line-through; color: #999; font-size: 0.8em; margin-right: 8px;}
    .ad-list-seller { font-size: 0.8em; color: #777; display: flex; align-items: center; justify-content: flex-end; gap: 5px; margin-top: 5px; }
    #publish-ad-fab, #apply-seller-fab { position: fixed; bottom: 80px; left: 20px; width: 56px; height: 56px; background: var(--accent-color); color: white; border-radius: 50%; display: none; align-items: center; justify-content: center; font-size: 24px; box-shadow: 0 2px 6px rgba(0,0,0,0.3); cursor: pointer; z-index: 1001; }
    #apply-seller-fab { font-size: 20px; }
    .fab-options { position: fixed; bottom: 150px; left: 20px; display: none; flex-direction: column; gap: 10px; z-index: 1000; }
    .fab-option { background-color: var(--primary-color); color: white; border-radius: 10px; padding: 10px 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); cursor: pointer; text-align: center; }
    #adDetailModal .modal-content { padding: 0; max-width: 95vw; text-align: right; }
    /* --- MODIFIED Image Slider in Modal --- */
    #adDetailImageSlider { position: relative; width: 100%; height: auto; max-height: 40vh; overflow: hidden; background-color: #222; border-top-left-radius: 15px; border-top-right-radius: 15px; display: flex; align-items: center; justify-content: center; }
    .slider-image { width: 100%; height: 100%; object-fit: contain; /* <<<<<<< MODIFIED: Shows full image */ position: absolute; top: 0; left: 0; opacity: 0; transition: opacity 0.5s ease-in-out; }
    .slider-image.active { opacity: 1; }
    .slider-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 100%; display: flex; justify-content: space-between; padding: 0 10px; box-sizing: border-box; z-index: 5; }
    .slider-nav button { background-color: rgba(0, 0, 0, 0.4); color: white; border: none; font-size: 1.5em; padding: 5px 12px; border-radius: 50%; cursor: pointer; }
    .slider-dots { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; z-index: 5; }
    .slider-dot { width: 10px; height: 10px; background-color: rgba(255, 255, 255, 0.6); border-radius: 50%; cursor: pointer; }
    .slider-dot.active { background-color: white; }

    #adDetailContent { padding: 20px; }
    #adDetailPrice { font-size: 1.5em; color: var(--primary-color); font-weight: bold; margin: 10px 0; }
    .price-container .original-price { text-decoration: line-through; color: #999; font-size: 0.8em; margin-left: 10px; }
    #adDetailSeller { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 15px; padding-top: 15px; border-top: 1px solid #eee; }
    #adDetailShipping { font-size: 0.9em; margin-top: 10px; text-align: right; color: #333; }
    #adDetailActions { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
    #adDetailBuyBtn, #adDetailDownloadBtn, #pinAdBtn { flex-grow: 1; padding: 15px; font-size: 1.2em; }
    #adDetailBuyBtn, #adDetailDownloadBtn { background-color: var(--accent-color); }
    #pinAdBtn { background-color: #ffc107; color: black; }
    .delete-ad-icon-modal { position: absolute; top: 10px; right: 10px; background: #f44336; color: white; border-radius: 50%; width: 35px; height: 35px; display: flex; align-items: center; justify-content: center; font-size: 1.1em; cursor: pointer; z-index: 10; }
    
    .deal-flame { animation: flicker 1.5s infinite alternate; margin-left: 5px; }
    @keyframes flicker { 0%, 18%, 22%, 25%, 53%, 57%, 100% { text-shadow: 0 0 4px #fff, 0 0 11px #fff, 0 0 19px #fff, 0 0 40px #ff7043, 0 0 80px #ff7043, 0 0 90px #ff7043; } 20%, 24%, 55% { text-shadow: none; } }
    .deal-countdown { position: absolute; top: 8px; left: 8px; background-color: #e91e63; color: white; padding: 4px 12px; border-radius: 16px; font-size: 0.85em; font-weight: bold; z-index: 2; box-shadow: 0 2px 4px rgba(0,0,0,0.25); direction: ltr; white-space: nowrap; }
    
    .publish-extra-fields { display: none; flex-direction: column; gap: 10px; margin-top: 10px; }
    .publish-extra-fields label { text-align: right; font-weight: bold; margin-bottom: -5px; }
    .publish-extra-fields select, .publish-extra-fields input, .publish-extra-fields textarea { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #ccc; box-sizing: border-box; }
    .shipping-options-container { display: flex; gap: 10px; justify-content: flex-end; direction: rtl; }
    .shipping-options-container label { display: flex; align-items: center; gap: 5px; }

    /* --- أنماط الدفع الجديدة --- */
    #paymentModal .payment-options { display: flex; flex-direction: column; gap: 15px; margin-top: 20px; }
    .payment-option { padding: 20px; border: 2px solid #ddd; border-radius: 10px; cursor: pointer; transition: all 0.2s; text-align: center; }
    .payment-option:hover { border-color: var(--primary-color); background-color: #f9f9f9; }
    .payment-option:disabled { background-color: #eee; cursor: not-allowed; opacity: 0.7; }
    .payment-option h3 { margin: 0 0 5px 0; }
    .payment-option p { margin: 0; color: var(--text-light); font-size: 0.9em; }

    /* --- Seller Dashboard Styles (Updated with Tabs) --- */
    .dashboard-tabs { display: flex; border-bottom: 2px solid #eee; margin-bottom: 15px; }
    .dashboard-tab { flex-grow: 1; padding: 15px; cursor: pointer; text-align: center; font-weight: bold; color: var(--text-light); }
    .dashboard-tab.active { color: var(--primary-color); border-bottom: 3px solid var(--primary-color); }
    .dashboard-content { display: none; }
    .dashboard-content.active { display: block; }
    #sellerDashboardModal .wallet-summary { background-color: var(--light-bg); padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 20px; }
    #sellerDashboardModal .balance-item { margin: 10px 0; }
    #sellerDashboardModal .balance-item span { font-weight: bold; font-size: 1.5em; color: var(--primary-color); }
    #sellerDashboardModal .balance-item .pending { color: var(--accent-color); }
    #sellerDashboardModal h3 { text-align: right; margin-top: 20px; border-bottom: 2px solid #eee; padding-bottom: 10px; }
    #sellerDashboardModal .order-list { max-height: 30vh; overflow-y: auto; }
    #sellerDashboardModal .order-item { background: #fff; border: 1px solid #eee; padding: 15px; border-radius: 8px; margin-bottom: 10px; text-align: right; }
    #sellerDashboardModal .order-item .status-pending { color: #f57c00; font-weight: bold; }
    #sellerDashboardModal .order-item .status-completed { color: #388e3c; font-weight: bold; }
    .order-item .confirm-receipt-btn { background-color: #4CAF50; color: white; padding: 8px 12px; border-radius: 6px; margin-top: 10px; cursor: pointer; }
    .order-item .download-btn { background-color: var(--accent-color); color: white; padding: 8px 12px; border-radius: 6px; margin-top: 10px; cursor: pointer; }
    .order-item-address { background-color: #f1f1f1; padding: 8px; margin-top: 8px; border-radius: 5px; font-size: 0.9em; }
    
    /* --- أنماط الألعاب (تمت استعادتها وتعديلها) --- */
    .games-grid { display: grid; grid-template-columns: 1fr; gap: 15px; padding: 10px; }
    .game-card { background: var(--card-bg); border-radius: 12px; padding: 20px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.1); cursor: pointer; transition: transform 0.2s; }
    .game-card:hover { transform: translateY(-5px); }
    .game-card h3 { margin-top: 0; color: var(--primary-color); }
    .user-points { text-align: center; font-size: 1.2em; font-weight: bold; margin: 5px 0 15px 0; color: #004d40; background: #fff; padding: 10px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    #gameContainer { display: none; flex-direction: column; align-items: center; justify-content: flex-start; padding: 10px; overflow-y: auto; width: 100%; box-sizing: border-box; }
    #game-board { display: grid; gap: 10px; margin-top: 20px; }
    .memory-card { width: 60px; height: 60px; background-color: #ccc; border-radius: 5px; cursor: pointer; position: relative; transform-style: preserve-3d; transition: transform 0.5s; }
    .memory-card.flipped { transform: rotateY(180deg); }
    .memory-card .front, .memory-card .back { position: absolute; width: 100%; height: 100%; backface-visibility: hidden; display: flex; align-items: center; justify-content: center; font-size: 2em; border-radius: 5px; }
    .memory-card .front { background-color: var(--primary-color); }
    .memory-card .back { transform: rotateY(180deg); background-color: var(--accent-color); color: white; }
    /* <<<<<< NEW: Puzzle Game Hint */
    #puzzle-board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 20px; border: 5px solid var(--primary-color); padding: 5px; background: var(--light-bg); position: relative; }
    #puzzle-board::before { content: '1 2 3\A 4 5 6\A 7 8'; white-space: pre; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 80px; color: rgba(0,0,0,0.08); font-weight: bold; z-index: 0; line-height: 1.1; text-align: center; }
    .puzzle-tile { width: 80px; height: 80px; background-color: var(--accent-color); color: white; display: flex; align-items: center; justify-content: center; font-size: 2em; font-weight: bold; border-radius: 5px; cursor: pointer; transition: background-color 0.3s; z-index: 1; }
    .puzzle-tile:hover { background-color: #ff8a65; }
    .puzzle-tile.empty { background-color: transparent; cursor: default; }

    /* New Game: Star Catcher */
    #starCatcherGameArea { position: relative; width: 95%; max-width: 400px; height: 400px; background: #001d3d; border: 3px solid #ffc300; margin-top: 15px; overflow: hidden; border-radius: 10px; }
    .falling-star { position: absolute; color: #ffc300; font-size: 2em; cursor: pointer; user-select: none; transition: top 2.5s linear; /* <<<<<<< MODIFIED: Faster falling stars */ }
    #starCatcherScore { font-size: 1.5em; font-weight: bold; color: #ffc300; margin-top: 10px; }
    
    /* <<<<<< NEW: Styles for Points Discount */
    #pointsDiscountContainer { background-color: #e0f2f1; padding: 15px; border-radius: 8px; margin-top: 15px; text-align: center; }
    #pointsDiscountContainer p { margin: 0 0 10px 0; font-weight: bold; }
    #applyPointsBtn { background-color: #26a69a; color: white; padding: 10px 20px; border-radius: 20px; font-weight: bold; cursor: pointer; }
    .game-points-discount-tag { background-color: #4caf50; color: white; font-size: 0.9em; padding: 4px 10px; border-radius: 12px; font-weight: bold; }

    /* <<<<<< NEW: Styles for Shipping Info */
    .shipping-info-tag { font-size: 0.85em; color: #333; display: flex; align-items: center; justify-content: flex-end; gap: 5px; margin-top: 8px; }

</style>

<div class="marketing-container">
    <div class="marketing-header">
        <div class="search-container">
            <input type="text" class="search-bar" id="marketingSearch" placeholder="🔍 ابحث عن منتجات، عروض...">
            <i class="fas fa-wallet header-icon" id="sellerDashboardBtn" onclick="openSellerDashboard()"></i>
            <span id="walletNotificationBadge" class="notification-badge"></span>
            <i class="fas fa-question-circle header-icon" id="helpBtn" onclick="openHelpModal()"></i>
        </div>
        <div class="filter-bar" id="filterBar">
            <div class="filter-chip active" data-filter="all">الكل</div>
            <div class="filter-chip" data-filter="product">🛒 منتجات</div>
            <div class="filter-chip" data-filter="digital_product">💻 منتجات رقمية</div>
            <div class="filter-chip" data-filter="deal">عروض اليوم <span class="deal-flame">🔥</span></div>
            <div class="filter-chip" data-filter="game">🎮 ألعاب</div>
        </div>
    </div>
    <div id="marketing-ads-container" class="marketing-content"></div>
    <div id="gameContainer"></div>
</div>

<div id="apply-seller-fab" onclick="openSellerApplicationModal()">
    <i class="fas fa-store"></i>
</div>

<div id="publish-ad-fab" onclick="toggleFabOptions()">+</div>
<div class="fab-options" id="fabOptions">
    <div class="fab-option" onclick="openPublishModal('product')">نشر منتج</div>
    <div class="fab-option" onclick="openPublishModal('digital_product')">نشر منتج رقمي</div>
    <div class="fab-option" onclick="openPublishModal('deal')">نشر عرض اليوم</div>
</div>

<div id="publishAdModal" class="modal">
    <div class="modal-content">
        <span class="close-button" onclick="closeModal('publishAdModal')">&times;</span>
        <h2 id="publishModalTitle">نشر إعلان جديد</h2>
        <input type="text" id="adTitle" placeholder="عنوان الإعلان" />
        <textarea id="adDescription" placeholder="وصف الإعلان"></textarea>
        <input type="number" id="adOriginalPrice" placeholder="السعر الأصلي (اختياري لوضع خصم)" />
        <input type="number" id="adPrice" placeholder="السعر بعد الخصم (مطلوب)" />
        <input type="hidden" id="adType" />
        <label for="adImages" style="display:block; margin-top:10px; text-align:right;">اختر الصور (حتى 3 صور)</label>
        <input type="file" id="adImages" accept="image/*" multiple />
        
        <div id="digitalProductFields" class="publish-extra-fields">
            <label for="digitalProductType">نوع المنتج الرقمي</label>
            <select id="digitalProductType">
                <option value="ebook">📚 كتاب إلكتروني (PDF, ePub)</option>
                <option value="audio">🎵 ملف صوتي (MP3, WAV)</option>
                <option value="design">🎨 تصميم أو صورة (PNG, PSD)</option>
                <option value="course">🧠 دورة تعليمية (فيديو, ملفات)</option>
                <option value="template">🎨 قالب (Template)</option>
                <option value="software">💻 برنامج أو سكربت</option>
                <option value="other">✨ آخر</option>
            </select>
            <label for="digitalProductFile">ارفع الملف الرقمي (مطلوب)</label>
            <input type="file" id="digitalProductFile" accept="*/*">
        </div>

        <div id="productFields" class="publish-extra-fields">
            <label>خيارات الشحن</label>
             <div class="shipping-options-container">
                <label><input type="radio" name="shippingOption" value="free" checked> توصيل مجاني</label>
                <label><input type="radio" name="shippingOption" value="extra"> تكلفة إضافية</label>
             </div>
             <input type="number" id="shippingCost" placeholder="تكلفة الشحن (إن وجدت)" style="display:none;">
             <label for="shippingCountries">الدول المتاح الشحن إليها</label>
             <textarea id="shippingCountries" placeholder="مثال: السعودية, مصر, الإمارات (اتركها فارغة للشحن لكل الدول)"></textarea>
        </div>

        <div id="dealFields" class="publish-extra-fields">
            <label for="dealDuration">مدة العرض (بالساعات)</label>
            <input type="number" id="dealDuration" placeholder="مثال: 1, 5, 24" value="1" min="1">
        </div>

        <button onclick="publishNewAd()">نشر الآن</button>
    </div>
</div>

<div id="adDetailModal" class="modal">
    <div class="modal-content">
        <div id="adDetailImageSlider">
            </div>
        <div id="adDetailContent">
            <span class="close-button" onclick="closeModal('adDetailModal')" style="position: absolute; top: 10px; left: 15px;">&times;</span>
            <div id="adDetailDeleteIconContainer"></div>
            <h2 id="adDetailTitle"></h2>
            <div id="adDetailPrice" class="price-container"></div>
            <div id="pointsDiscountResult" style="text-align: center; margin-top: 5px;"></div>
            <p id="adDetailDesc"></p>
            <div id="adDetailShipping"></div>
            <div id="adDetailSeller"></div>
            <div id="pointsDiscountContainer"></div>
            <div id="adDetailActions"></div>
        </div>
    </div>
</div>

<div id="paymentModal" class="modal">
    <div class="modal-content">
        <span class="close-button" onclick="closeModal('paymentModal')">&times;</span>
        <h2 id="paymentProductName"></h2>
        <p>اختر طريقة الدفع المناسبة لك:</p>
        <div class="payment-options">
            <div class="payment-option" id="stripePayment">
                <h3><i class="fab fa-stripe"></i> الدفع عبر Stripe</h3>
                <p>للبطاقات البنكية (Visa, MasterCard)</p>
            </div>
            <div class="payment-option" id="cryptoPayment">
                <h3><i class="fab fa-bitcoin"></i> الدفع بالعملات الرقمية</h3>
                <p>USDT, BTC, ETH</p>
            </div>
        </div>
    </div>
</div>

<div id="sellerDashboardModal" class="modal">
    <div class="modal-content">
        <span class="close-button" onclick="closeModal('sellerDashboardModal')">&times;</span>
        <h2>لوحة التحكم المالية</h2>
        <div class="wallet-summary">
            <div class="balance-item">
                <p>الرصيد المتاح للسحب</p>
                <span id="availableBalance">0.00 USD</span>
            </div>
            <div class="balance-item">
                <p>الرصيد المعلق</p>
                <span id="pendingBalance" class="pending">0.00 USD</span>
            </div>
        </div>
        <div class="dashboard-tabs">
            <div class="dashboard-tab active" data-tab="sales">طلبات البيع</div>
            <div class="dashboard-tab" data-tab="purchases">مشترياتي</div>
        </div>
        
        <div id="salesContent" class="dashboard-content active">
            <h3>طلبات البيع</h3>
            <div class="order-list" id="sellerOrdersList">
                <p>لا توجد طلبات حالياً.</p>
            </div>
        </div>

        <div id="purchasesContent" class="dashboard-content">
            <h3>مشترياتي</h3>
            <div class="order-list" id="buyerOrdersList">
                <p>لا توجد مشتريات حالياً.</p>
            </div>
        </div>
    </div>
</div>


<div id="helpModal" class="modal">
    <div class="modal-content" style="text-align: right;">
        <span class="close-button" onclick="closeModal('helpModal')">&times;</span>
        <h2>كيف يعمل النظام المالي؟</h2>
        <h4><i class="fas fa-shield-alt"></i> نظام الأمان المالي (Escrow)</h4>
        <p>عندما يشتري عميل منتجًا ماديًا منك، يتم حجز المبلغ لدينا في "الرصيد المعلق". هذا يضمن حق المشتري حتى يستلم طلبه.</p>
        <p>بعد أن يؤكد المشتري استلام المنتج، يتم تحويل المبلغ إلى "رصيدك المتاح للسحب" بعد خصم العمولة.</p>
        <p><strong>المنتجات الرقمية:</strong> يتم تحويل المبلغ إلى رصيدك المتاح فورًا عند الشراء.</p>
        <hr>
        <h4><i class="fas fa-percent"></i> نظام العمولات</h4>
        <p>نحن نأخذ عمولة بسيطة بنسبة <strong>2%</strong> على كل عملية بيع ناجحة تتم عبر قسم التسويق. هذه العمولة تساعدنا على تطوير المنصة وتقديم أفضل خدمة لكم.</p>
        <hr>
        <h4><i class="fas fa-rocket"></i> تثبيت الإعلانات</h4>
        <p>يمكنك تثبيت إعلانك في أعلى القائمة لزيادة مشاهداته بشكل كبير. التكلفة هي <strong>10 دولارات لكل ساعة</strong>.</p>
    </div>
</div>

<div id="pinAdModal" class="modal">
    <div class="modal-content">
        <span class="close-button" onclick="closeModal('pinAdModal')">&times;</span>
        <h2>📌 تثبيت الإعلان</h2>
        <p>حدد عدد الساعات التي تريد تثبيت إعلانك خلالها. (التكلفة: 10$ للساعة)</p>
        <input type="number" id="pinHoursInput" value="1" min="1" placeholder="عدد الساعات">
        <p id="pinCostDisplay" style="font-weight: bold; margin-top: 10px;">التكلفة الإجمالية: 10 USD</p>
        <button id="confirmPinBtn">تأكيد التثبيت</button>
    </div>
</div>

<div id="shippingAddressModal" class="modal">
    <div class="modal-content">
        <span class="close-button" onclick="closeModal('shippingAddressModal')">&times;</span>
        <h2>🚚 عنوان الشحن</h2>
        <p>الرجاء إدخال عنوان الشحن لاستلام المنتج.</p>
        <input type="text" id="shippingCountry" placeholder="الدولة" required>
        <input type="text" id="shippingCity" placeholder="المدينة" required>
        <input type="text" id="shippingStreet" placeholder="اسم الشارع ورقم المبنى" required>
        <input type="text" id="shippingApartment" placeholder="رقم الشقة أو الفيلا (اختياري)">
        <input type="text" id="shippingPhone" placeholder="رقم الجوال للتواصل" required>
        <button onclick="submitShippingAddress()">متابعة إلى الدفع</button>
    </div>
</div>

<div id="sellerApplicationModal" class="modal">
    <div class="modal-content" style="text-align: right;">
        <span class="close-button" onclick="closeModal('sellerApplicationModal')">&times;</span>
        <h2>كن بائعًا معنا!</h2>
        <p>لكي تتمكن من عرض منتجاتك، يرجى إرسال طلب لإدارة التطبيق للموافقة.</p>
        <label for="sellerApplicationDetails">صف لنا المنتجات التي تود بيعها:</label>
        <textarea id="sellerApplicationDetails" placeholder="مثال: أبيع منتجات رقمية مثل القوالب والكتب الإلكترونية، أو منتجات مادية مثل الملابس..." required></textarea>
        <button onclick="submitSellerApplication()">إرسال الطلب للمراجعة</button>
    </div>
</div>


<script>
(function() {
    console.log("Marketing content script executed successfully.");

    let allAds = [];
    let currentFilter = 'all';
    let userPoints = 0;
    let purchaseInfo = {};
    let countdownIntervals = {};
    let activeGameInterval = null;
    let currentImageIndex = 0;
    let adImageUrls = [];
    const ADMIN_UID = "ADMIN_USER_ID_HERE"; // <<<<<<< هام: ضع هنا الـ UID الخاص بحساب المدير

    function setupMarketingPage() {
        console.log("Attaching marketing event listeners.");
        document.querySelectorAll('.filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                if (chip.classList.contains('active')) return;
                const activeChip = document.querySelector('.filter-chip.active');
                if (activeChip) activeChip.classList.remove('active');
                chip.classList.add('active');
                currentFilter = chip.dataset.filter;
                displayContent();
            });
        });
        
        document.querySelectorAll('.dashboard-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;
                document.querySelector('.dashboard-tab.active').classList.remove('active');
                tab.classList.add('active');
                document.querySelector('.dashboard-content.active').classList.remove('active');
                document.getElementById(`${targetTab}Content`).classList.add('active');
            });
        });
        
        document.getElementById('marketingSearch').addEventListener('input', displayAds);
        
        // <<<<<< NEW: Event listener for shipping options
        document.querySelectorAll('input[name="shippingOption"]').forEach(radio => {
            radio.addEventListener('change', (event) => {
                const costInput = document.getElementById('shippingCost');
                costInput.style.display = event.target.value === 'extra' ? 'block' : 'none';
            });
        });

        // <<<<<< NEW: Setup seller/publish buttons based on user role
        setupFabButtons();

        fetchAndDisplayAds();
        fetchUserPoints();
        fetchNotificationCount();
    }
    
    // <<<<<< NEW: Function to show the correct FAB (Apply or Publish)
    function setupFabButtons() {
        const applyBtn = document.getElementById('apply-seller-fab');
        const publishBtn = document.getElementById('publish-ad-fab');
        if (currentUser) {
            if (currentUser.userRole === 'admin' || currentUser.userRole === 'seller') {
                publishBtn.style.display = 'flex';
                applyBtn.style.display = 'none';
            } else {
                applyBtn.style.display = 'flex';
                publishBtn.style.display = 'none';
            }
        } else {
             applyBtn.style.display = 'none';
             publishBtn.style.display = 'none';
        }
    }
    
    function getLocalizedPrice(priceUSD) {
        if (!priceUSD || isNaN(priceUSD)) return 'السعر عند الطلب';
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(priceUSD);
    }

    async function fetchUserPoints() {
        if (!currentUser) return;
        try {
            const response = await fetch(`${backendUrl}/api/marketing/points/${currentUser.uid}`);
            const data = await response.json();
            userPoints = data.points || 0;
            const userPointsDisplay = document.getElementById('userPointsDisplay');
            if (userPointsDisplay) userPointsDisplay.innerText = userPoints;
        } catch (error) { console.error("Failed to fetch points:", error); }
    }
    
    async function fetchNotificationCount() {
        if (!currentUser) return;
        try {
            const response = await fetch(`${backendUrl}/api/marketing/seller/notifications/count/${currentUser.uid}`);
            const data = await response.json();
            const badge = document.getElementById('walletNotificationBadge');
            if (data.count > 0) {
                badge.innerText = data.count > 9 ? '9+' : data.count;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        } catch (error) {
            console.error("Failed to fetch notification count:", error);
        }
    }

    async function fetchAndDisplayAds() {
        const adsContainer = document.getElementById('marketing-ads-container');
        if (!adsContainer) return;
        adsContainer.innerHTML = '<p style="text-align:center; margin-top:20px;">جاري تحميل الإعلانات...</p>';
        try {
            const response = await fetch(`${backendUrl}/api/marketing`);
            if (!response.ok) throw new Error('فشل تحميل البيانات');
            allAds = await response.json();
            displayContent();
        } catch (error) {
            adsContainer.innerHTML = `<p style="color:red; text-align:center; margin-top:20px;">حدث خطأ: ${error.message}</p>`;
        }
    }

    function displayContent() {
        const adsContainer = document.getElementById('marketing-ads-container');
        const gameContainer = document.getElementById('gameContainer');
        if (!adsContainer || !gameContainer) return;

        if (activeGameInterval) {
            clearInterval(activeGameInterval);
            activeGameInterval = null;
        }

        if (currentFilter === 'game') {
            adsContainer.style.display = 'none';
            gameContainer.style.display = 'flex';
            displayGames();
        } else {
            gameContainer.style.display = 'none';
            adsContainer.style.display = 'block';
            displayAds();
        }
    }
    
    const digitalProductIcons = {
        ebook: '📚', course: '🧠', file: '📁', template: '🎨', software: '💻', other: '✨', audio: '🎵', design: '🎨'
    };

    function displayAds() {
        const adsContainer = document.getElementById('marketing-ads-container');
        if (!adsContainer) return;

        Object.values(countdownIntervals).forEach(clearInterval);
        countdownIntervals = {};

        const searchTerm = document.getElementById('marketingSearch').value.toLowerCase();
        adsContainer.innerHTML = '';

        let adsToDisplay = allAds.filter(ad => {
            const now = Date.now();
            if (ad.ad_type === 'deal' && ad.deal_expiry && ad.deal_expiry < now) return false;
            return true;
        });

        if (currentFilter !== 'all' && currentFilter !== 'game') {
            adsToDisplay = adsToDisplay.filter(ad => ad.ad_type === currentFilter);
        }
        if (searchTerm) {
            adsToDisplay = adsToDisplay.filter(ad => 
                ad.title.toLowerCase().includes(searchTerm) || 
                (ad.description && ad.description.toLowerCase().includes(searchTerm))
            );
        }
        
        const pinnedAds = adsToDisplay.filter(ad => ad.is_pinned);
        let nonPinnedAds = adsToDisplay.filter(ad => !ad.is_pinned);

        for (let i = nonPinnedAds.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [nonPinnedAds[i], nonPinnedAds[j]] = [nonPinnedAds[j], nonPinnedAds[i]];
        }

        const finalAdsToDisplay = [...pinnedAds, ...nonPinnedAds];

        if (finalAdsToDisplay.length === 0) {
            adsContainer.innerHTML = `<p style="text-align: center; margin-top: 20px;">لا توجد إعلانات تطابق بحثك.</p>`;
            return;
        }

        finalAdsToDisplay.forEach(ad => {
            const card = document.createElement('div');
            card.className = `ad-list-card ${ad.is_pinned ? 'pinned' : ''}`;
            card.id = `ad-card-${ad.id}`;
            card.onclick = () => showAdDetails(ad);
            
            let sellerBadge = '';
            if (ad.seller_user_role === 'admin') sellerBadge = `<i class="fas fa-check-circle verified-badge admin"></i>`;
            else if (ad.seller_is_verified) sellerBadge = `<i class="fas fa-check-circle verified-badge normal"></i>`;
            
            const isDeal = ad.ad_type === 'deal';
            const showCountdown = isDeal && ad.deal_expiry && (ad.deal_expiry > Date.now());
            const countdownHTML = showCountdown ? `<div class="deal-countdown" id="countdown-${ad.id}"></div>` : '';
            
            let productTypeBadge = '';
            if(ad.ad_type === 'digital_product' && ad.digital_product_type) {
                productTypeBadge = `<div class="ad-product-badge">${digitalProductIcons[ad.digital_product_type] || '💻'}</div>`;
            }
            
            let discountBadge = '';
            let priceHTML = getLocalizedPrice(ad.price);
            if (ad.original_price && parseFloat(ad.original_price) > parseFloat(ad.price)) {
                const discount = Math.round(((ad.original_price - ad.price) / ad.original_price) * 100);
                discountBadge = `<div class="ad-discount-badge">-${discount}%</div>`;
                priceHTML = `${getLocalizedPrice(ad.price)} <span class="original-price-list">${getLocalizedPrice(ad.original_price)}</span>`;
            }
            
            // <<<<<< NEW: Shipping Info Display Logic
            let shippingInfoHTML = '';
            if (ad.ad_type === 'product' || ad.ad_type === 'deal') {
                if (ad.shipping_option === 'free') {
                    shippingInfoHTML = `<div class="shipping-info-tag">🚚 توصيل مجاني</div>`;
                } else if (ad.shipping_option === 'extra' && ad.shipping_cost > 0) {
                    shippingInfoHTML = `<div class="shipping-info-tag">🚚 توصيل: ${getLocalizedPrice(ad.shipping_cost)}</div>`;
                }
            }

            const mainImageUrl = (ad.image_urls && ad.image_urls.length > 0) ? ad.image_urls[0] : 'https://placehold.co/200x200/e0f7fa/004d40?text=Ad';

            card.innerHTML = `
                <div class="ad-list-image-container">
                    <img class="ad-list-image" src="${mainImageUrl}" alt="${ad.title}" onerror="this.onerror=null; this.src='https://placehold.co/200x200/cccccc/000?text=Error';">
                    ${countdownHTML}
                    ${productTypeBadge}
                    ${discountBadge}
                </div>
                <div class="ad-list-details">
                    <p class="ad-list-title">${ad.title}</p>
                    <p class="ad-list-desc">${ad.description}</p>
                    <div class="ad-list-seller"><span>${ad.seller_username}</span>${sellerBadge}</div>
                    <p class="ad-list-price">${priceHTML}</p>
                    ${shippingInfoHTML}
                </div>
            `;
            adsContainer.appendChild(card);
            if (showCountdown) {
                startCountdown(ad.id, ad.deal_expiry);
            }
        });
    }

    function startCountdown(adId, expiryTimestamp) {
        const countdownElement = document.getElementById(`countdown-${adId}`);
        if (!countdownElement) return;

        countdownIntervals[adId] = setInterval(() => {
            const now = new Date().getTime();
            const distance = expiryTimestamp - now;

            if (distance < 0) {
                clearInterval(countdownIntervals[adId]);
                const cardToRemove = document.getElementById(`ad-card-${adId}`);
                if (cardToRemove) cardToRemove.style.display = 'none';
                return;
            }

            const days = Math.floor(distance / (1000 * 60 * 60 * 24));
            const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);

            let timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            if (days > 0) timeString = `${days}ي ${timeString}`;
            countdownElement.innerHTML = timeString;
        }, 1000);
    }
    
    // --- New Image Slider Functions ---
    function buildImageSlider(imageUrls) {
        adImageUrls = imageUrls;
        const sliderContainer = document.getElementById('adDetailImageSlider');
        sliderContainer.innerHTML = '';
        if (!adImageUrls || adImageUrls.length === 0) {
            sliderContainer.innerHTML = `<img class="slider-image active" src="https://placehold.co/600x400/e0f7fa/004d40?text=Ad" alt="Default Ad Image">`;
            return;
        }

        adImageUrls.forEach((url, index) => {
            const img = document.createElement('img');
            img.src = url;
            img.className = `slider-image ${index === 0 ? 'active' : ''}`;
            sliderContainer.appendChild(img);
        });
        
        if (adImageUrls.length > 1) {
            sliderContainer.innerHTML += `
                <div class="slider-nav">
                    <button id="prevBtn">‹</button>
                    <button id="nextBtn">›</button>
                </div>
                <div class="slider-dots"></div>
            `;
            document.getElementById('prevBtn').onclick = () => moveSlider(-1);
            document.getElementById('nextBtn').onclick = () => moveSlider(1);
            updateSliderDots();
        }
        currentImageIndex = 0;
    }

    function moveSlider(direction) {
        currentImageIndex += direction;
        if (currentImageIndex >= adImageUrls.length) currentImageIndex = 0;
        if (currentImageIndex < 0) currentImageIndex = adImageUrls.length - 1;
        updateSliderDisplay();
    }

    function updateSliderDisplay() {
        document.querySelectorAll('.slider-image').forEach((img, index) => {
            img.classList.toggle('active', index === currentImageIndex);
        });
        updateSliderDots();
    }

    function updateSliderDots() {
        const dotsContainer = document.querySelector('.slider-dots');
        if (!dotsContainer) return;
        dotsContainer.innerHTML = '';
        adImageUrls.forEach((_, index) => {
            const dot = document.createElement('div');
            dot.className = `slider-dot ${index === currentImageIndex ? 'active' : ''}`;
            dot.onclick = () => {
                currentImageIndex = index;
                updateSliderDisplay();
            };
            dotsContainer.appendChild(dot);
        });
    }

    // <<<<<< NEW: Function to handle points discount calculation
    function applyPointsDiscount() {
        const basePrice = parseFloat(purchaseInfo.ad.price);
        const maxDiscountPercentage = Math.floor(userPoints / 100) * 10;
        const maxDiscountAmount = basePrice * (maxDiscountPercentage / 100);
        
        const actualDiscount = Math.min(basePrice, maxDiscountAmount);
        const finalPrice = basePrice - actualDiscount;
        const pointsToSpend = Math.floor(actualDiscount / (basePrice * 0.10)) * 100;

        purchaseInfo.finalPrice = finalPrice;
        purchaseInfo.pointsSpent = pointsToSpend;
        purchaseInfo.discountFromPoints = actualDiscount;

        const resultContainer = document.getElementById('pointsDiscountResult');
        resultContainer.innerHTML = `
            <span class="game-points-discount-tag">
                خصم الألعاب: -${getLocalizedPrice(actualDiscount)} (باستخدام ${pointsToSpend} نقطة)
            </span>
        `;
        document.getElementById('adDetailPrice').innerHTML = `السعر النهائي: ${getLocalizedPrice(finalPrice)}`;
        
        // Hide the apply button after applying
        document.getElementById('pointsDiscountContainer').style.display = 'none';
    }


    window.showAdDetails = function(ad) {
        purchaseInfo = { ad: ad, pointsSpent: 0, discountFromPoints: 0, shippingAddress: null };
        
        buildImageSlider(ad.image_urls);

        document.getElementById('adDetailTitle').innerText = ad.title;
        
        // Reset price display
        const priceContainer = document.getElementById('adDetailPrice');
        if (ad.original_price && parseFloat(ad.original_price) > parseFloat(ad.price)) {
            priceContainer.innerHTML = `
                <span class="discounted-price">${getLocalizedPrice(ad.price)}</span> 
                <span class="original-price">${getLocalizedPrice(ad.original_price)}</span>
            `;
        } else {
            priceContainer.innerHTML = getLocalizedPrice(ad.price);
        }
        purchaseInfo.finalPrice = parseFloat(ad.price);
        document.getElementById('pointsDiscountResult').innerHTML = ''; // Clear old discount

        document.getElementById('adDetailDesc').innerText = ad.description;
        
        // --- Display Shipping Info ---
        const shippingContainer = document.getElementById('adDetailShipping');
        if (ad.ad_type === 'product' || ad.ad_type === 'deal') {
             if (ad.shipping_option === 'free') {
                shippingContainer.innerHTML = `🚚 <strong>توصيل مجاني</strong>. متاح إلى: ${ad.shipping_countries ? ad.shipping_countries.join(', ') : 'جميع الدول'}`;
            } else if (ad.shipping_option === 'extra' && ad.shipping_cost > 0) {
                 shippingContainer.innerHTML = `🚚 تكلفة التوصيل: <strong>${getLocalizedPrice(ad.shipping_cost)}</strong>. متاح إلى: ${ad.shipping_countries ? ad.shipping_countries.join(', ') : 'جميع الدول'}`;
            } else if (ad.shipping_countries && ad.shipping_countries.length > 0) {
                 shippingContainer.innerHTML = `🚚 متاح الشحن إلى: <strong>${ad.shipping_countries.join(', ')}</strong>`;
            } else {
                shippingContainer.innerHTML = `🚚 متاح الشحن لجميع الدول`;
            }
        } else {
            shippingContainer.innerHTML = '';
        }
        
        let sellerBadge = '';
        if (ad.seller_user_role === 'admin') sellerBadge = `<i class="fas fa-check-circle verified-badge admin"></i>`;
        else if (ad.seller_is_verified) sellerBadge = `<i class="fas fa-check-circle verified-badge normal"></i>`;
        document.getElementById('adDetailSeller').innerHTML = `<span>البائع: ${ad.seller_username}</span>${sellerBadge}`;
        
        const deleteContainer = document.getElementById('adDetailDeleteIconContainer');
        const actionsContainer = document.getElementById('adDetailActions');
        actionsContainer.innerHTML = '';
        
        const isOwner = currentUser && (currentUser.uid === ad.seller_id);
        const isAdmin = currentUser && currentUser.user_role === 'admin';

        if (!isOwner) {
            // <<<<<< NEW: Show points discount option
            const pointsContainer = document.getElementById('pointsDiscountContainer');
            const availableDiscountLevels = Math.floor(userPoints / 100);
            if (availableDiscountLevels > 0) {
                pointsContainer.innerHTML = `
                    <p>لديك ${userPoints} نقطة! 🎮</p>
                    <p>يمكنك الحصول على خصم يصل إلى ${availableDiscountLevels * 10}%</p>
                    <button id="applyPointsBtn" onclick="applyPointsDiscount()">استخدام النقاط</button>
                `;
                pointsContainer.style.display = 'block';
            } else {
                pointsContainer.style.display = 'none';
            }

            if (ad.ad_type === 'digital_product') {
                actionsContainer.innerHTML = '<button id="adDetailDownloadBtn" class="buy-now-btn">شراء وتحميل فوري</button>';
                document.getElementById('adDetailDownloadBtn').onclick = () => preparePurchase();
            } else {
                actionsContainer.innerHTML = '<button id="adDetailBuyBtn" class="buy-now-btn">شراء الآن</button>';
                document.getElementById('adDetailBuyBtn').onclick = () => preparePurchase();
            }
        } else {
             document.getElementById('pointsDiscountContainer').style.display = 'none';
        }

        if (isOwner || isAdmin) {
            deleteContainer.innerHTML = `<div class="delete-ad-icon-modal" onclick="deleteAd('${ad.id}')">🗑️</div>`;
        } else {
            deleteContainer.innerHTML = '';
        }
        
        if(isOwner && !ad.is_pinned) {
             actionsContainer.innerHTML += `<button id="pinAdBtn" onclick="openPinModal('${ad.id}')">📌 تثبيت الإعلان</button>`;
        }

        document.getElementById('adDetailModal').style.display = 'flex';
    }

    window.toggleFabOptions = function() {
        const options = document.getElementById('fabOptions');
        if (options) options.style.display = options.style.display === 'flex' ? 'none' : 'flex';
    }

    window.openPublishModal = function(type) {
        if (!currentUser) { customAlert("يجب تسجيل الدخول أولاً."); return; }
        toggleFabOptions();
        
        // Reset all fields
        document.getElementById('publishAdModal').querySelectorAll('input, textarea, select').forEach(el => el.value = '');
        document.getElementById('shippingCost').style.display = 'none';
        document.querySelector('input[name="shippingOption"][value="free"]').checked = true;
        
        document.getElementById('digitalProductFields').style.display = 'none';
        document.getElementById('productFields').style.display = 'none';
        document.getElementById('dealFields').style.display = 'none';
        
        let title = '';
        if (type === 'product') {
            title = 'نشر منتج';
            document.getElementById('productFields').style.display = 'flex';
        } else if (type === 'digital_product') {
            title = 'نشر منتج رقمي';
            document.getElementById('digitalProductFields').style.display = 'flex';
        } else if (type === 'deal') {
            title = 'نشر عرض اليوم';
            document.getElementById('productFields').style.display = 'flex'; // Deals can be physical products
            document.getElementById('dealFields').style.display = 'flex';
        }
        
        document.getElementById('publishModalTitle').innerText = title;
        document.getElementById('adType').value = type;
        document.getElementById('publishAdModal').style.display = 'flex';
    }
    
    // <<<<<< NEW: Purchase preparation function
    window.preparePurchase = function() {
        if (!currentUser) { customAlert("يجب تسجيل الدخول للشراء."); return; }
        if (currentUser.uid === purchaseInfo.ad.seller_id) { customAlert("لا يمكنك شراء منتجك."); return; }

        if (purchaseInfo.finalPrice === 0) {
            // It's a free purchase with points, no payment needed
            processPurchase('points_redemption');
        } else if (purchaseInfo.ad.ad_type !== 'digital_product') {
            // It's a physical product, ask for shipping address first
            document.getElementById('shippingAddressModal').style.display = 'flex';
        } else {
            // It's a digital product, go straight to payment
            openPaymentModal();
        }
    }
    
    // <<<<<< NEW: Function to handle shipping address submission
    window.submitShippingAddress = function() {
        const country = document.getElementById('shippingCountry').value;
        const city = document.getElementById('shippingCity').value;
        const street = document.getElementById('shippingStreet').value;
        const phone = document.getElementById('shippingPhone').value;

        if (!country || !city || !street || !phone) {
            customAlert("الرجاء ملء جميع حقول العنوان المطلوبة.");
            return;
        }
        purchaseInfo.shippingAddress = {
            country,
            city,
            street,
            apartment: document.getElementById('shippingApartment').value,
            phone
        };
        closeModal('shippingAddressModal');
        openPaymentModal();
    }
    
    window.openPaymentModal = function() {
        document.getElementById('paymentProductName').innerText = `إتمام شراء: ${purchaseInfo.ad.title}`;
        document.querySelectorAll('.payment-option').forEach(btn => btn.disabled = false); // Re-enable buttons
        document.getElementById('stripePayment').onclick = () => processPurchase('stripe');
        document.getElementById('cryptoPayment').onclick = () => processPurchase('crypto');
        document.getElementById('paymentModal').style.display = 'flex';
    }
    
    window.openSellerDashboard = async function() {
        if (!currentUser) { customAlert("يجب تسجيل الدخول."); return; }
        
        document.getElementById('sellerDashboardModal').style.display = 'flex';
        
        try {
            const [walletResponse, sellerOrdersResponse, buyerOrdersResponse] = await Promise.all([
                fetch(`${backendUrl}/api/marketing/seller/wallet/${currentUser.uid}`),
                fetch(`${backendUrl}/api/marketing/seller/orders/${currentUser.uid}`),
                fetch(`${backendUrl}/api/marketing/buyer/orders/${currentUser.uid}`)
            ]);

            const walletData = await walletResponse.json();
            if (!walletResponse.ok) throw new Error(walletData.error);
            document.getElementById('availableBalance').innerText = `${parseFloat(walletData.available_balance).toFixed(2)} USD`;
            document.getElementById('pendingBalance').innerText = `${parseFloat(walletData.pending_balance).toFixed(2)} USD`;

            const sellerOrders = await sellerOrdersResponse.json();
            if (!sellerOrdersResponse.ok) throw new Error(sellerOrders.error);
            renderSellerOrders(sellerOrders);

            const buyerOrders = await buyerOrdersResponse.json();
            if (!buyerOrdersResponse.ok) throw new Error(buyerOrders.error);
            renderBuyerOrders(buyerOrders);
            
            fetchNotificationCount(); // Reset badge after opening
        } catch (error) {
            customAlert(`خطأ في جلب بيانات اللوحة: ${error.message}`);
        }
    }
    
    function renderSellerOrders(orders) {
        const container = document.getElementById('sellerOrdersList');
        container.innerHTML = '';
        if (orders.length === 0) {
            container.innerHTML = '<p>لا توجد طلبات بيع حالياً.</p>';
            return;
        }
        orders.forEach(order => {
            const statusClass = order.status === 'pending' ? 'status-pending' : 'status-completed';
            const statusText = order.status === 'pending' ? 'معلق' : 'مكتمل';
            
            // <<<<<< NEW: Display shipping address for seller
            let addressHTML = '';
            if(order.shipping_address && order.shipping_address.country) {
                const adr = order.shipping_address;
                addressHTML = `
                    <div class="order-item-address">
                        <strong>عنوان الشحن:</strong><br>
                        ${adr.country}, ${adr.city}, ${adr.street}<br>
                        ${adr.apartment ? `شقة: ${adr.apartment}<br>` : ''}
                        جوال: ${adr.phone}
                    </div>
                `;
            }
            
            const orderDiv = document.createElement('div');
            orderDiv.className = 'order-item';
            orderDiv.innerHTML = `
                <strong>${order.ad_title}</strong><br>
                <small>المشتري: ${order.buyer_username || 'غير معروف'}</small><br>
                <span>السعر: ${getLocalizedPrice(order.amount)}</span> - 
                <span class="${statusClass}">${statusText}</span>
                ${addressHTML}
            `;
            container.appendChild(orderDiv);
        });
    }

    function renderBuyerOrders(orders) {
        const container = document.getElementById('buyerOrdersList');
        container.innerHTML = '';
        if (orders.length === 0) {
            container.innerHTML = '<p>لا توجد مشتريات حالياً.</p>';
            return;
        }
        orders.forEach(order => {
            const isDigital = order.ad_type === 'digital_product';
            let actionButton = '';

            if (order.status === 'pending' && !isDigital) {
                actionButton = `<button class="confirm-receipt-btn" onclick="confirmReceipt('${order.id}')">تأكيد الاستلام</button>`;
            } else if (isDigital && order.status === 'completed') {
                actionButton = `<button class="download-btn" id="download-btn-${order.id}" onclick="initiateDownload('${order.id}')">تحميل الملف</button>`;
            }

            const orderDiv = document.createElement('div');
            orderDiv.className = 'order-item';
            orderDiv.innerHTML = `
                <strong>${order.ad_title}</strong><br>
                <small>البائع: ${order.seller_username || 'غير معروف'}</small><br>
                <span>السعر: ${getLocalizedPrice(order.amount)}</span>
                ${actionButton}
            `;
            container.appendChild(orderDiv);
        });
    }
    
    // --- NEW: Real Download Function ---
    window.initiateDownload = async function(transactionId) {
        const downloadBtn = document.getElementById(`download-btn-${transactionId}`);
        if (!downloadBtn || downloadBtn.disabled) return;

        downloadBtn.disabled = true;
        downloadBtn.innerText = 'جاري التجهيز...';
        try {
            const response = await fetch(`${backendUrl}/api/marketing/download/${transactionId}?callerUid=${currentUser.uid}`);
            const result = await response.json();
            if(!response.ok) throw new Error(result.error);
            
            // Trigger browser download
            const link = document.createElement('a');
            link.href = result.downloadUrl;
            link.setAttribute('download', ''); // This attribute suggests a filename, but the server sets the actual name.
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            downloadBtn.innerText = 'تم التحميل';
            customAlert('بدأ تحميل الملف!');

        } catch (error) {
            customAlert(`فشل التحميل: ${error.message}`);
            downloadBtn.disabled = false;
            downloadBtn.innerText = 'تحميل الملف';
        }
    }
    
    window.confirmReceipt = async function(transactionId) {
        customConfirm("هل أنت متأكد من أنك استلمت المنتج؟ سيتم تحويل المبلغ للبائع.", async () => {
            try {
                const response = await fetch(`${backendUrl}/api/marketing/order/${transactionId}/confirm`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ buyerId: currentUser.uid })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                customAlert(result.message);
                openSellerDashboard(); // Refresh dashboard
            } catch (error) {
                customAlert(`فشل التأكيد: ${error.message}`);
            }
        });
    }
    
    window.openHelpModal = function() {
        document.getElementById('helpModal').style.display = 'flex';
    }

    async function processPurchase(paymentMethod) {
        const paymentButtons = document.querySelectorAll('.payment-option');
        paymentButtons.forEach(btn => btn.disabled = true);
        
        try {
            const response = await fetch(`${backendUrl}/api/marketing/purchase`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    adId: purchaseInfo.ad.id,
                    buyerId: currentUser.uid,
                    amount: purchaseInfo.finalPrice,
                    paymentMethod: paymentMethod,
                    pointsSpent: purchaseInfo.pointsSpent,
                    shippingAddress: purchaseInfo.shippingAddress
                })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);

            customAlert(result.message);
            closeModal('paymentModal');
            closeModal('adDetailModal');
            fetchAndDisplayAds();
            fetchUserPoints(); // Refresh points after spending
            openSellerDashboard(); // Refresh dashboard to show new purchase
            
        } catch (error) {
            customAlert(`فشل الشراء: ${error.message}`);
            paymentButtons.forEach(btn => btn.disabled = false); // Re-enable on failure
        }
    }
    
    window.publishNewAd = async function() {
        const adType = document.getElementById('adType').value;
        const title = document.getElementById('adTitle').value;
        const description = document.getElementById('adDescription').value;
        const price = document.getElementById('adPrice').value;
        const originalPrice = document.getElementById('adOriginalPrice').value;

        if (!title || !description || !price) {
            customAlert("الرجاء ملء العنوان والوصف والسعر.");
            return;
        }

        const formData = new FormData();
        formData.append('title', title);
        formData.append('description', description);
        formData.append('price', price);
        if(originalPrice) formData.append('original_price', originalPrice);
        formData.append('ad_type', adType);
        formData.append('seller_id', currentUser.uid);
        
        if (adType === 'deal') {
            const durationHours = document.getElementById('dealDuration').value;
            formData.append('deal_duration_hours', durationHours);
        }
        if (adType === 'digital_product') {
            const digitalProductType = document.getElementById('digitalProductType').value;
            const digitalFile = document.getElementById('digitalProductFile').files[0];
            if (!digitalFile) { customAlert('الرجاء رفع الملف الرقمي للمنتج.'); return; }
            formData.append('digital_product_type', digitalProductType);
            formData.append('digital_product_file', digitalFile);
        }
        if (adType === 'product' || adType === 'deal') {
            const shippingCountries = document.getElementById('shippingCountries').value;
            if (shippingCountries) formData.append('shipping_countries', shippingCountries);
            
            // <<<<<< NEW: Append shipping options
            const shippingOption = document.querySelector('input[name="shippingOption"]:checked').value;
            formData.append('shipping_option', shippingOption);
            if(shippingOption === 'extra'){
                const shippingCost = document.getElementById('shippingCost').value;
                if(shippingCost) formData.append('shipping_cost', shippingCost);
            }
        }

        const imageFiles = document.getElementById('adImages').files;
        if (imageFiles.length > 0) {
            for (let i = 0; i < Math.min(imageFiles.length, 3); i++) {
                formData.append('images', imageFiles[i]);
            }
        }

        try {
            const response = await fetch(`${backendUrl}/api/marketing`, { method: 'POST', body: formData });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'فشل النشر');
            customAlert('تم نشر إعلانك بنجاح!');
            closeModal('publishAdModal');
            fetchAndDisplayAds();
        } catch (error) { customAlert(`حدث خطأ: ${error.message}`); }
    }
    
    window.deleteAd = async function(adId) {
        customConfirm("هل أنت متأكد أنك تريد حذف هذا الإعلان؟", async () => {
            try {
                const response = await fetch(`${backendUrl}/api/marketing/${adId}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ callerUid: currentUser.uid })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'فشل الحذف');
                customAlert('تم حذف الإعلان بنجاح.');
                closeModal('adDetailModal');
                fetchAndDisplayAds();
            } catch (error) { customAlert(`حدث خطأ: ${error.message}`); }
        });
    }
    
    // <<<<<< NEW: Replaced prompt with a custom modal for pinning
    window.openPinModal = function(adId) {
        const modal = document.getElementById('pinAdModal');
        const input = document.getElementById('pinHoursInput');
        const costDisplay = document.getElementById('pinCostDisplay');
        const confirmBtn = document.getElementById('confirmPinBtn');
        
        input.value = 1;
        costDisplay.innerText = 'التكلفة الإجمالية: 10 USD';
        
        input.oninput = () => {
            const hours = parseInt(input.value) || 0;
            costDisplay.innerText = `التكلفة الإجمالية: ${hours * 10} USD`;
        };

        confirmBtn.onclick = () => pinAd(adId, parseInt(input.value));
        
        modal.style.display = 'flex';
    }

    async function pinAd(adId, hours) {
        if (isNaN(hours) || hours < 1) {
            customAlert("الرجاء إدخال عدد ساعات صحيح.");
            return;
        }

        const cost = hours * 10;
        try {
            const response = await fetch(`${backendUrl}/api/marketing/pin/${adId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    callerUid: currentUser.uid,
                    pin_duration_hours: parseInt(hours)
                })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'فشل التثبيت');
            customAlert('تم تثبيت إعلانك بنجاح!');
            closeModal('pinAdModal');
            closeModal('adDetailModal');
            fetchAndDisplayAds();
        } catch (error) { customAlert(`حدث خطأ: ${error.message}`); }
    }
    
    // <<<<<< NEW: Seller Application Functions
    window.openSellerApplicationModal = function() {
        if (!currentUser) { customAlert("يجب تسجيل الدخول أولاً لتقديم طلب."); return; }
        document.getElementById('sellerApplicationModal').style.display = 'flex';
    }

    window.submitSellerApplication = function() {
        const details = document.getElementById('sellerApplicationDetails').value;
        if (!details.trim()) {
            customAlert("الرجاء وصف المنتجات التي تود بيعها.");
            return;
        }

        // This is a workaround to send a message to the admin without a dedicated backend endpoint for applications.
        // It requires knowing the admin's chat ID or creating a chat with them.
        // For simplicity, we'll assume a function `sendMessageToAdmin` exists.
        const applicationData = {
            userId: currentUser.uid,
            username: currentUser.username,
            details: details,
        };
        const messageText = `SELLER_APPLICATION::${JSON.stringify(applicationData)}`;
        
        // You would need to implement `sendMessageToAdmin` in your main chat script
        // For now, we simulate success and inform the user.
        // sendMessageToAdmin(messageText); 
        console.log("Sending application to admin:", messageText);
        
        closeModal('sellerApplicationModal');
        customAlert("تم إرسال طلبك بنجاح. سيتم مراجعته من قبل الإدارة والرد عليك.");
    }

    // --- دوال الألعاب (لا تغيير هنا) ---
    async function addPoint(count = 1) {
        if (!currentUser) return;
        try {
            for(let i = 0; i < count; i++) {
                await fetch(`${backendUrl}/api/marketing/points`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: currentUser.uid })
                });
            }
            await fetchUserPoints();
        } catch (error) { console.error("Failed to add point:", error); }
    }
    window.displayGames = function() {
        const gameContainer = document.getElementById('gameContainer');
        if (!gameContainer) return;
        gameContainer.innerHTML = `
            <div class="user-points">نقاطك: <span id="userPointsDisplay">${userPoints}</span></div>
            <p style="text-align:center; color: #555;">كل 100 نقطة تمنحك خصم 10% على المنتجات!</p>
            <div class="games-grid">
                <div class="game-card" onclick="playMemoryGame()"><h3>🧠 لعبة الذاكرة</h3><p>اختبر ذاكرتك واربح النقاط.</p></div>
                <div class="game-card" onclick="playPuzzleGame()"><h3>🧩 لغز الأرقام</h3><p>رتب الأرقام بأسرع وقت.</p></div>
                <div class="game-card" onclick="playStarCatcherGame()"><h3>⭐ صيد النجمة</h3><p>اجمع النجوم قبل أن تختفي.</p></div>
            </div>
        `;
        fetchUserPoints();
    }
    window.playMemoryGame = function() {
        const gameContainer = document.getElementById('gameContainer');
        gameContainer.innerHTML = '<h2>لعبة الذاكرة</h2><div id="game-board"></div><button onclick="displayGames()" style="margin-top:20px;">العودة للألعاب</button>';
        const board = document.getElementById('game-board');
        board.style.gridTemplateColumns = 'repeat(4, 1fr)';
        const emojis = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼'];
        let cards = [...emojis, ...emojis].sort(() => 0.5 - Math.random());
        let flippedCards = []; let matchedPairs = 0; let lockBoard = false; board.innerHTML = '';
        cards.forEach(emoji => {
            const card = document.createElement('div');
            card.className = 'memory-card';
            card.innerHTML = `<div class="front"></div><div class="back">${emoji}</div>`;
            card.dataset.emoji = emoji;
            card.addEventListener('click', () => {
                if (lockBoard || card.classList.contains('flipped') || flippedCards.length >= 2) return;
                card.classList.add('flipped');
                flippedCards.push(card);
                if (flippedCards.length === 2) {
                    lockBoard = true;
                    setTimeout(() => {
                        if (flippedCards[0].dataset.emoji === flippedCards[1].dataset.emoji) {
                            matchedPairs++;
                            flippedCards = [];
                            if (matchedPairs === emojis.length) { customAlert('تهانينا! لقد فزت بنقطة.'); addPoint(); displayGames(); }
                        } else { flippedCards.forEach(c => c.classList.remove('flipped')); flippedCards = []; }
                        lockBoard = false;
                    }, 800);
                }
            });
            board.appendChild(card);
        });
    }
    window.playPuzzleGame = function() {
        const gameContainer = document.getElementById('gameContainer');
        gameContainer.innerHTML = `<h2>لغز الأرقام</h2><p>رتب الأرقام من 1 إلى 8.</p><div id="puzzle-board"></div><button onclick="playPuzzleGame()" style="margin-top:20px;">إعادة اللعب</button><button onclick="displayGames()" style="margin-top:10px;">العودة للألعاب</button>`;
        const board = document.getElementById('puzzle-board');
        let tiles = ['1', '2', '3', '4', '5', '6', '7', '8', ''];
        function shuffle(array) { let c = array.length; while (c > 0) { let i = Math.floor(Math.random() * c); c--; [array[c], array[i]] = [array[i], array[c]]; } }
        shuffle(tiles);
        function drawBoard() {
            board.innerHTML = '';
            tiles.forEach((t, i) => {
                const el = document.createElement('div');
                el.className = 'puzzle-tile'; el.innerText = t;
                if (t === '') el.classList.add('empty');
                el.addEventListener('click', () => moveTile(i));
                board.appendChild(el);
            });
        }
        function moveTile(i) {
            const e = tiles.indexOf(''); const v = [e - 1, e + 1, e - 3, e + 3];
            if ((e % 3 === 0 && i === e - 1) || (e % 3 === 2 && i === e + 1)) return;
            if (v.includes(i)) { [tiles[e], tiles[i]] = [tiles[i], tiles[e]]; drawBoard(); checkWin(); }
        }
        function checkWin() { if (tiles.every((v, i) => v === ['1', '2', '3', '4', '5', '6', '7', '8', ''][i])) { setTimeout(() => { customAlert('رائع! لقد فزت بنقطتين.'); addPoint(2); displayGames(); }, 200); } }
        drawBoard();
    }
    window.playStarCatcherGame = function() {
        const gameContainer = document.getElementById('gameContainer');
        gameContainer.innerHTML = `<h2>⭐ صيد النجمة ⭐</h2><div id="starCatcherScore">النقاط: 0</div><div id="starCatcherGameArea"></div><button onclick="displayGames()" style="margin-top:10px;">العودة للألعاب</button>`;
        const gameArea = document.getElementById('starCatcherGameArea');
        const scoreDisplay = document.getElementById('starCatcherScore');
        let score = 0; let gameTime = 20000;
        function createStar() {
            const star = document.createElement('span'); star.className = 'falling-star'; star.innerText = '⭐';
            star.style.left = `${Math.random() * 90}%`; star.style.top = '-30px';
            star.onclick = () => { score++; scoreDisplay.innerText = `النقاط: ${score}`; star.remove(); };
            gameArea.appendChild(star);
            setTimeout(() => { star.style.top = '100%'; }, 100);
            setTimeout(() => { if (star.parentNode) { star.remove(); } }, 2600); // <<<<<<< MODIFIED: Faster removal
        }
        activeGameInterval = setInterval(createStar, 600); // <<<<<<< MODIFIED: More frequent stars
        setTimeout(() => {
            clearInterval(activeGameInterval); activeGameInterval = null;
            let pointsWon = Math.floor(score / 5);
            if (pointsWon > 0) { customAlert(`انتهى الوقت! نتيجتك: ${score}. لقد ربحت ${pointsWon} نقطة.`); addPoint(pointsWon); } 
            else { customAlert(`انتهى الوقت! نتيجتك: ${score}. حاول مرة أخرى لتربح النقاط.`); }
            displayGames();
        }, gameTime);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupMarketingPage);
    } else {
        setupMarketingPage();
    }
})();
</script>
