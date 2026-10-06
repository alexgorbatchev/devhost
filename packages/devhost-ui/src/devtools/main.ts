import { renderDevtools } from "./renderDevtools";
import { activatePristineFetch, pristineFetch } from "./shared/pristineFetch";
import { startDevtools } from "./startDevtools";

activatePristineFetch();
await startDevtools(pristineFetch, renderDevtools);
