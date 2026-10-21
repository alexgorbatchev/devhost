import { DevTool } from "@hookform/devtools";
import type { JSX } from "react";
import { useForm } from "react-hook-form";

export function ReactHookFormDemo(): JSX.Element {
  const { control, register, formState } = useForm({ mode: "onChange", defaultValues: { email: "" } });

  return (
    <section className="inspector-demo" aria-labelledby="react-hook-form-title">
      <h2 id="react-hook-form-title">React Hook Form</h2>
      <form aria-label="Contact">
        <label>
          Email
          <input {...register("email", { required: "Email required" })} />
        </label>
        <p role="alert">{formState.errors.email?.message}</p>
      </form>
      <DevTool control={control} placement="top-right" />
    </section>
  );
}
