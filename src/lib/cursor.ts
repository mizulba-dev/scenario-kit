// Playwright の録画にはカーソルが映らないため DOM で擬似カーソルを描画する。
// addInitScript でシリアライズされるので、この関数は外部参照なしで自己完結させること。
export const installCursor = (): void => {
  const ensure = () => {
    if (document.getElementById("__demo_cursor")) return;
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    Object.assign(c.style, {
      position: "fixed",
      left: "-100px",
      top: "-100px",
      width: "20px",
      height: "20px",
      borderRadius: "50%",
      background: "rgba(15,23,42,0.9)",
      border: "2.5px solid #fff",
      boxShadow: "0 1px 6px rgba(0,0,0,.45)",
      zIndex: "2147483647",
      pointerEvents: "none",
      transform: "translate(-50%,-50%)",
      transition: "width .12s, height .12s",
    });
    document.documentElement.appendChild(c);
    window.addEventListener(
      "mousemove",
      (e) => {
        c.style.left = `${e.clientX}px`;
        c.style.top = `${e.clientY}px`;
      },
      true,
    );
    window.addEventListener(
      "mousedown",
      () => {
        c.style.width = "14px";
        c.style.height = "14px";
      },
      true,
    );
    window.addEventListener(
      "mouseup",
      () => {
        c.style.width = "20px";
        c.style.height = "20px";
      },
      true,
    );
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensure);
  } else {
    ensure();
  }
};
