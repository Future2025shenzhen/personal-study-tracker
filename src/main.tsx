import { createRoot } from "react-dom/client";
import { Component, type ReactNode } from "react";
import App from "./App";
import "./style.css";
class Boundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="auth">
        <h1>暂时无法打开工作区</h1>
        <p>
          请保留浏览器数据并刷新重试，不要清除缓存。若问题持续，请联系维护者协助恢复。
        </p>
        <button onClick={() => location.reload()}>刷新</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <App />
  </Boundary>,
);
