import { Debouncer } from "@tanstack/pacer";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { useForm } from "@tanstack/react-form";
import { formDevtoolsPlugin } from "@tanstack/react-form-devtools";
import { pacerDevtoolsPlugin } from "@tanstack/react-pacer-devtools";
import { rowSelectionFeature, tableFeatures, useTable } from "@tanstack/react-table";
import { tableDevtoolsPlugin, useTanStackTableDevtools } from "@tanstack/react-table-devtools";
import { useEffect, useState, type JSX } from "react";

const features = tableFeatures({ rowSelectionFeature });
const columns = [{ accessorKey: "name", header: "Name" }];
const people = [{ name: "Ada" }, { name: "Grace" }, { name: "Linus" }];

// The unified TanStack shell with its Form, Table, and Pacer plugins, each fed by a real library instance.
export function TanStackLibrariesDemo(): JSX.Element {
  const form = useForm({ defaultValues: { name: "Ada" }, formId: "playground-profile" });
  const table = useTable({ key: "playground-people", features, columns, data: people });
  useTanStackTableDevtools(table);
  const [plugins] = useState(() => [formDevtoolsPlugin(), tableDevtoolsPlugin(), pacerDevtoolsPlugin()]);
  const [savedName, setSavedName] = useState("nothing yet");
  const [debouncer] = useState(
    () => new Debouncer((value: string) => setSavedName(value), { key: "playground-save-name", wait: 2000 }),
  );
  useEffect(() => () => debouncer.cancel(), [debouncer]);

  return (
    <section className="inspector-demo" aria-labelledby="tanstack-libraries-title">
      <h2 id="tanstack-libraries-title">TanStack Form, Table, and Pacer</h2>
      <form.Field name="name">
        {(field) => (
          <label>
            Name
            <input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => {
                field.handleChange(event.target.value);
                debouncer.maybeExecute(event.target.value);
              }}
            />
          </label>
        )}
      </form.Field>
      <p>
        Saved two seconds after typing stops: <output aria-label="Debounced name">{savedName}</output>
      </p>
      <ul className="inspector-demo-rows">
        {table.getRowModel().rows.map((row) => (
          <li key={row.id}>
            <label>
              <input type="checkbox" checked={row.getIsSelected()} onChange={() => row.toggleSelected()} />
              {row.original.name}
            </label>
          </li>
        ))}
      </ul>
      <TanStackDevtools plugins={plugins} config={{ defaultOpen: false }} />
    </section>
  );
}
