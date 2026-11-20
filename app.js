// ==========================================
// ⚙️ 設定區
// ==========================================
const GOOGLE_CLIENT_ID = "41397361871-ieh71tib6jg1a8g6tnpn2fdbh1ncdkt6.apps.googleusercontent.com";
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzH6vJyfnsB32uh8ybMZ2E2fFSUDBuSD9CJGekBIX6flMDI4iSmKMvOi-wqO5JLmTn0ZQ/exec";

const urlParams = new URLSearchParams(window.location.search);
const ALBUM_NAME = urlParams.get("album") || "103";

// 全域狀態變數
let currentIdToken = "";
let currentUserRole = "guest"; // "admin" | "student" | "parent"
const loadedCache = {};

// 初始化 Google 登入按鈕
window.onload = function()
{
  if(typeof google !== "undefined" && google.accounts)
  {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse
    });

    google.accounts.id.renderButton(
      document.getElementById("googleSignInBtn"),
      { theme: "filled_blue", size: "large", shape: "pill", width: 250 }
    );
  }
  else
  {
    showToast("Google 登入元件載入失敗，請檢查網路連線");
  }
};

/**
 * 右上角非干擾提示訊息 (Toast)
 */
function showToast(msg)
{
  let toast = document.getElementById("toastMsg");
  if(!toast)
  {
    toast = document.createElement("div");
    toast.id = "toastMsg";
    toast.className = "toast-msg";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function()
  {
    toast.classList.remove("show");
  }, 2600);
}

/**
 * 統一呼叫 GAS doPost API 的封裝函式
 */
async function callGasApi(payload)
{
  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  if(!response.ok)
  {
    throw new Error("HTTP 錯誤狀態: " + response.status);
  }

  return await response.json();
}

/**
 * Google 登入成功回呼
 */
async function handleCredentialResponse(response)
{
  currentIdToken = response.credential;

  document.getElementById("loginCard").style.display = "none";
  document.getElementById("noAccessCard").style.display = "none";
  const loadingEl = document.getElementById("loading");
  loadingEl.textContent = "驗證白名單權限中...";
  loadingEl.style.display = "block";

  try
  {
    // 1. 驗證白名單與角色
    const verifyRes = await callGasApi({
      action: "verifyUser",
      idToken: currentIdToken,
      album: ALBUM_NAME
    });

    if(!verifyRes.success)
    {
      loadingEl.style.display = "none";
      document.getElementById("noAccessMsg").textContent = verifyRes.message || "您的帳號未在授權名單中。";
      document.getElementById("noAccessCard").style.display = "block";
      return;
    }

    currentUserRole = verifyRes.role || "parent";

    // 2. 驗證通過，向 GAS 取得相簿媒體清單
    loadingEl.textContent = "讀取相簿清單中...";
    const listRes = await callGasApi({
      action: "getPhotoList",
      idToken: currentIdToken,
      album: ALBUM_NAME
    });

    loadingEl.style.display = "none";

    if(!listRes.success)
    {
      showToast("讀取清單失敗: " + listRes.message);
      return;
    }

    renderGallery(listRes.items || []);
  }
  catch(err)
  {
    loadingEl.style.display = "none";
    showToast("連線發生錯誤: " + err.message);
    document.getElementById("loginCard").style.display = "block";
  }
}

/**
 * 切換帳號
 */
function resetAndSwitchAccount()
{
  currentIdToken = "";
  currentUserRole = "guest";
  if(typeof google !== "undefined" && google.accounts)
  {
    google.accounts.id.disableAutoSelect();
  }
  document.getElementById("noAccessCard").style.display = "none";
  document.getElementById("loginCard").style.display = "block";
}

/**
 * 渲染相簿骨架並掛載懶加載監聽器
 */
function renderGallery(items)
{
  const gallery = document.getElementById("gallery");
  const sidebar = document.getElementById("thumbSidebar");
  gallery.innerHTML = "";
  sidebar.innerHTML = "";

  if(items.length === 0)
  {
    gallery.style.display = "block";
    gallery.innerHTML = "<div class='photo-slide' style='color:#fff;'>資料夾內沒有可瀏覽的媒體檔案</div>";
    return;
  }

  const mainObserver = new IntersectionObserver(function(entries, observer)
  {
    entries.forEach(function(entry)
    {
      if(entry.isIntersecting)
      {
        const slideEl = entry.target;
        const fileId = slideEl.getAttribute("data-id");
        const mediaType = slideEl.getAttribute("data-type");

        loadMainMedia(slideEl, fileId, mediaType);
        observer.unobserve(slideEl);
      }
    });
  }, { root: gallery, rootMargin: "100% 0px 100% 0px" });

  const thumbObserver = new IntersectionObserver(function(entries, observer)
  {
    entries.forEach(function(entry)
    {
      if(entry.isIntersecting)
      {
        const thumbEl = entry.target;
        const fileId = thumbEl.getAttribute("data-id");
        const mediaType = thumbEl.getAttribute("data-type");

        loadSideThumb(thumbEl, fileId, mediaType);
        observer.unobserve(thumbEl);
      }
    });
  }, { root: sidebar, rootMargin: "200px 0px 200px 0px" });

  const canSeeLimitStyle = (currentUserRole === "admin" || currentUserRole === "student");

  for(let i = 0; i < items.length; i++)
  {
    const item = items[i];
    const isLimit = Boolean(item.isLimit);

    // 1. 主畫面佔位 Slide
    const slide = document.createElement("div");
    slide.className = "photo-slide" + ((canSeeLimitStyle && isLimit) ? " is-limit" : "");
    slide.id = "slide-" + i;
    slide.setAttribute("data-index", i);
    slide.setAttribute("data-id", item.id);
    slide.setAttribute("data-type", item.type);
    slide.setAttribute("data-limit", isLimit ? "1" : "0");
    slide.textContent = "載入中...";
    gallery.appendChild(slide);
    mainObserver.observe(slide);

    // 2. 左側縮圖佔位 Item
    const thumb = document.createElement("div");
    thumb.className = "thumb-item" + (i === 0 ? " active" : "") + ((canSeeLimitStyle && isLimit) ? " is-limit" : "");
    thumb.id = "thumb-" + i;
    thumb.setAttribute("data-index", i);
    thumb.setAttribute("data-id", item.id);
    thumb.setAttribute("data-type", item.type);
    thumb.textContent = (i + 1);

    thumb.addEventListener("click", function()
    {
      const idx = this.getAttribute("data-index");
      const targetSlide = document.getElementById("slide-" + idx);
      if(targetSlide)
      {
        targetSlide.scrollIntoView({ behavior: "smooth" });
      }
    });

    sidebar.appendChild(thumb);
    thumbObserver.observe(thumb);
  }

  gallery.style.display = "block";
  sidebar.style.display = "flex";
  document.getElementById("scrollHint").style.display = "flex";

  bindScrollAndDragEvents(gallery, sidebar);
}

/**
 * 非同步向 GAS 取得大圖 Base64 (1600px)
 */
async function loadMainMedia(slideEl, fileId, mediaType)
{
  if(mediaType === "video")
  {
    slideEl.innerHTML = "<div style='text-align:center;color:#aaa;'>🎬 私有影片不支援直接 Base64 預覽<br><small>(檔案 ID: " + fileId + ")</small></div>";
    return;
  }

  const cacheKey = fileId + "_1600";
  if(loadedCache[cacheKey])
  {
    renderImageToSlide(slideEl, loadedCache[cacheKey]);
    return;
  }

  try
  {
    const res = await callGasApi({
      action: "getThumbnailBase64",
      idToken: currentIdToken,
      fileId: fileId,
      size: 1600
    });

    if(res.success && res.dataUrl)
    {
      loadedCache[cacheKey] = res.dataUrl;
      renderImageToSlide(slideEl, res.dataUrl);
    }
    else
    {
      slideEl.textContent = "圖片載入失敗: " + (res.message || "未知錯誤");
    }
  }
  catch(err)
  {
    slideEl.textContent = "連線逾時，無法載入圖片";
  }
}

/**
 * 渲染主圖片，若為 admin 則在圖片右上角加上鎖定按鈕
 */
function renderImageToSlide(slideEl, dataUrl)
{
  slideEl.textContent = "";

  const wrapper = document.createElement("div");
  wrapper.className = "media-wrapper";

  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "";
  wrapper.appendChild(img);

  // Admin 專用：每張照片旁邊加上鎖的按鈕
  if(currentUserRole === "admin")
  {
    const isLimit = (slideEl.getAttribute("data-limit") === "1");
    const lockBtn = document.createElement("button");
    lockBtn.className = "admin-lock-btn" + (isLimit ? " locked" : "");
    lockBtn.title = isLimit ? "點擊解除家長限制 (_limit)" : "點擊設為家長限制 (_limit)";
    lockBtn.textContent = isLimit ? "🔒" : "🔓";

    lockBtn.addEventListener("click", function(e)
    {
      e.stopPropagation();
      handleToggleLimit(slideEl, lockBtn);
    });

    wrapper.appendChild(lockBtn);
  }

  slideEl.appendChild(wrapper);
}

/**
 * Admin 點擊鎖按鈕：呼叫 GAS 切換檔名 "_limit" 並即時更新綠框與圖示
 */
async function handleToggleLimit(slideEl, lockBtn)
{
  const fileId = slideEl.getAttribute("data-id");
  const index = slideEl.getAttribute("data-index");
  const thumbEl = document.getElementById("thumb-" + index);

  lockBtn.disabled = true;
  showToast("更新檔案限制狀態中...");

  try
  {
    const res = await callGasApi({
      action: "toggleLimit",
      idToken: currentIdToken,
      album: ALBUM_NAME,
      fileId: fileId
    });

    if(res.success)
    {
      const nowLimit = Boolean(res.isLimit);
      slideEl.setAttribute("data-limit", nowLimit ? "1" : "0");

      if(nowLimit)
      {
        slideEl.classList.add("is-limit");
        if(thumbEl)
        {
          thumbEl.classList.add("is-limit");
        }
        lockBtn.classList.add("locked");
        lockBtn.textContent = "🔒";
        lockBtn.title = "點擊解除家長限制 (_limit)";
        showToast("已設為家長隱藏：" + res.newName);
      }
      else
      {
        slideEl.classList.remove("is-limit");
        if(thumbEl)
        {
          thumbEl.classList.remove("is-limit");
        }
        lockBtn.classList.remove("locked");
        lockBtn.textContent = "🔓";
        lockBtn.title = "點擊設為家長限制 (_limit)";
        showToast("已解除限制：" + res.newName);
      }
    }
    else
    {
      showToast("操作失敗：" + (res.message || "未知錯誤"));
    }
  }
  catch(err)
  {
    showToast("連線錯誤：" + err.message);
  }
  finally
  {
    lockBtn.disabled = false;
  }
}

/**
 * 非同步向 GAS 取得側邊欄小縮圖 Base64 (150px)
 */
async function loadSideThumb(thumbEl, fileId, mediaType)
{
  if(mediaType === "video")
  {
    thumbEl.innerHTML = "<span style='color:#fff;font-size:20px;'>🎬</span>";
    return;
  }

  const cacheKey = fileId + "_150";
  if(loadedCache[cacheKey])
  {
    renderImageToThumb(thumbEl, loadedCache[cacheKey]);
    return;
  }

  try
  {
    const res = await callGasApi({
      action: "getThumbnailBase64",
      idToken: currentIdToken,
      fileId: fileId,
      size: 150
    });

    if(res.success && res.dataUrl)
    {
      loadedCache[cacheKey] = res.dataUrl;
      renderImageToThumb(thumbEl, res.dataUrl);
    }
  }
  catch(err)
  {
    // 縮圖失敗維持編號顯示即可
  }
}

function renderImageToThumb(thumbEl, dataUrl)
{
  thumbEl.textContent = "";
  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "";
  thumbEl.appendChild(img);
}

/**
 * 綁定滾動焦點切換與 PC 滑鼠拖曳滑動事件
 */
function bindScrollAndDragEvents(gallery, sidebar)
{
  gallery.addEventListener("scroll", function()
  {
    const hint = document.getElementById("scrollHint");
    if(gallery.scrollTop > 50)
    {
      hint.style.opacity = "0";
    }
    else
    {
      hint.style.opacity = "1";
    }

    const currentIndex = Math.round(gallery.scrollTop / window.innerHeight);
    const activeThumb = sidebar.querySelector(".thumb-item.active");
    const newActiveThumb = document.getElementById("thumb-" + currentIndex);

    if(newActiveThumb && activeThumb !== newActiveThumb)
    {
      if(activeThumb)
      {
        activeThumb.classList.remove("active");
      }
      newActiveThumb.classList.add("active");
      newActiveThumb.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  let isMouseDown = false;
  let startY = 0;
  let scrollTop = 0;

  gallery.addEventListener("mousedown", function(e)
  {
    if(e.target.closest(".thumb-sidebar") || e.target.closest(".admin-lock-btn") || e.target.tagName === "VIDEO")
    {
      return;
    }

    isMouseDown = true;
    gallery.style.scrollSnapType = "none";
    gallery.style.scrollBehavior = "auto";
    startY = e.pageY - gallery.offsetTop;
    scrollTop = gallery.scrollTop;
  });

  gallery.addEventListener("mouseleave", function()
  {
    if(isMouseDown)
    {
      endDrag();
    }
  });

  gallery.addEventListener("mouseup", function()
  {
    if(isMouseDown)
    {
      endDrag();
    }
  });

  gallery.addEventListener("mousemove", function(e)
  {
    if(!isMouseDown)
    {
      return;
    }
    e.preventDefault();
    const y = e.pageY - gallery.offsetTop;
    const walk = (y - startY) * 1.5;
    gallery.scrollTop = scrollTop - walk;
  });

  function endDrag()
  {
    isMouseDown = false;
    gallery.style.scrollSnapType = "y mandatory";
    gallery.style.scrollBehavior = "smooth";
  }
}
