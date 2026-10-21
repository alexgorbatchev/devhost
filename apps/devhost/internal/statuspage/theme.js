(() => {
  const preference = matchMedia("(prefers-color-scheme: light)");
  const update = () => {
    document.documentElement.dataset.theme = preference.matches ? "light" : "dark";
  };
  update();
  preference.addEventListener("change", update);
})();
