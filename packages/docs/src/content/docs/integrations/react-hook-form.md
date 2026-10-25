---
title: "React Hook Form"
---

devhost adds a **Form 1**, **Form 2**, … toolbar entry for each React Hook Form `DevTool` panel on your page and hides the panels' floating launchers.

## Requirements

| Package              | Tested version |
| -------------------- | -------------- |
| `@hookform/devtools` | 4.4.0          |
| `react-hook-form`    | 7.89.0         |

Other versions are untested, and the React Hook Form browser extension is not supported.

## Set up

1. Install `react-hook-form` and `@hookform/devtools` in your app; see the [upstream quickstart](https://github.com/react-hook-form/devtools#quickstart).
2. Keep `[devtools.externalToolbars].enabled = true` (the default) in `devhost.toml`:

   ```toml
   [devtools.externalToolbars]
   enabled = true
   ```

3. Mount `DevTool` with your form's `control`:

   ```tsx
   import { DevTool } from "@hookform/devtools";
   import { useForm } from "react-hook-form";

   export function ProfileForm() {
     const { control, register } = useForm({
       mode: "onChange",
       defaultValues: { email: "" },
     });

     return (
       <>
         <form aria-label="Profile">
           <label>
             Email
             <input {...register("email", { required: "Email required" })} />
           </label>
         </form>
         <DevTool control={control} placement="top-right" />
       </>
     );
   }
   ```

## Use it

Each entry opens and closes one panel. Entries are numbered in the order devhost finds the panels, not by form name or `DevTool`'s `id` prop; open one to see which form it shows. Give each `DevTool` a different `placement` so panels do not overlap.

Setting `[devtools.externalToolbars].enabled = false` brings back the native launchers without opening or closing any panel.

## Limitations

- Reordering panels keeps their numbers. A replaced or remounted panel gets a new number, and numbering starts over when the page reloads.
- If the React Hook Form browser extension makes `DevTool` render no panel, there is no entry.
