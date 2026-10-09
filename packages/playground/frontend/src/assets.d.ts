declare module "*.svg" {
  const url: string;
  export default url;
}

// Stylesheets are imported for their side effect only; Bun bundles them into the page.
declare module "*.css";
