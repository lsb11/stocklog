export {};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": {
        children?: import("react").ReactNode;
        [key: string]: unknown;
      };
    }
  }
}
