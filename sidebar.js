(() => {
  'use strict';

  const brands = navigator.userAgentData?.brands || [];
  const isOpera = Boolean(globalThis.opr?.sidebarAction)
    || /\bOPR\//i.test(navigator.userAgent)
    || brands.some((brand) => /opera/i.test(brand.brand || ''));

  if (isOpera) {
    location.replace(chrome.runtime.getURL('options.html?source=opera-sidebar'));
  } else {
    document.querySelector('#unsupported').style.display = 'block';
  }
})();
