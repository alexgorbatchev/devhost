import { useQuery } from "@tanstack/react-query";
import type { JSX } from "react";
import { fetchHello } from "../fetchHello";

export function QueryPlayground(): JSX.Element {
  const query = useQuery({
    queryKey: ["playground", "hello"],
    queryFn: ({ signal }) => fetchHello(fetch, signal),
    staleTime: 30_000,
  });

  return (
    <section className="query-playground" aria-labelledby="query-heading">
      <h2 id="query-heading">Backend query</h2>
      <p>
        This query requests <code>/api/hello</code>. Refetch it or navigate away to see the cache change in Query devtools.
      </p>
      <button type="button" className="send-button" disabled={query.isFetching} onClick={() => void query.refetch()}>
        Refetch query
      </button>
      {query.isFetching && <p role="status">Fetching backend response…</p>}
      {query.isError && <p role="alert">{query.error.message}</p>}
      {query.isSuccess && <pre aria-label="Query response">{query.data}</pre>}
    </section>
  );
}
