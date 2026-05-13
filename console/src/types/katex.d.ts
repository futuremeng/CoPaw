declare module "katex/contrib/auto-render" {
  const renderMathInElement: (element: HTMLElement, options?: Record<string, unknown>) => void;
  export default renderMathInElement;
}
