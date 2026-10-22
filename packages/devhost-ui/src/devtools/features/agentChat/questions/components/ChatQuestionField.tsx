import { Checkbox, Input, RadioGroup, RadioGroupItem } from "@alexgorbatchev/shadcn";
import { useId, type ChangeEvent, type ReactElement } from "react";
import type { IChatQuestion, IChatQuestionSelection } from "../types";

interface IChatQuestionFieldProps {
  question: IChatQuestion;
  value: IChatQuestionSelection;
  onChange: (value: IChatQuestionSelection) => void;
  disabled?: boolean;
}
export function ChatQuestionField({ question, value, onChange, disabled }: IChatQuestionFieldProps): ReactElement {
  const prefix = useId();
  const selectedIndex = question.options.findIndex((option) => value.selected.includes(option.label));
  const choose = (choice: unknown): void => {
    if (choice === "other") {
      onChange({ ...value, isOther: true, selected: [] });
      return;
    }
    const option = question.options.find((_, index) => String(index) === choice);
    if (option) onChange({ ...value, isOther: false, selected: [option.label] });
  };
  const choices = question.options.map((option, index) => (
    <div key={option.label} className="flex items-start gap-2">
      {question.isMultiple ? (
        <Checkbox
          id={prefix + "-" + index}
          aria-describedby={prefix + "-description-" + index}
          checked={value.selected.includes(option.label)}
          disabled={disabled}
          onCheckedChange={(checked: boolean) =>
            onChange({
              ...value,
              selected: checked
                ? [...value.selected.filter((entry) => entry !== option.label), option.label]
                : value.selected.filter((entry) => entry !== option.label),
            })
          }
        />
      ) : (
        <RadioGroupItem
          id={prefix + "-" + index}
          value={String(index)}
          aria-describedby={prefix + "-description-" + index}
        />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={prefix + "-" + index} className="text-base">
          {option.label}
        </label>
        <p id={prefix + "-description-" + index} className="text-xs text-muted-foreground">
          {option.description}
        </p>
        {option.preview ? <pre className="overflow-auto whitespace-pre-wrap text-xs">{option.preview}</pre> : null}
      </div>
    </div>
  ));
  return (
    <fieldset
      disabled={disabled}
      data-testid="ChatQuestionField"
      className="flex min-w-0 flex-col gap-2 rounded-sm border border-border p-2"
    >
      <legend className="px-1 text-xs font-medium">{question.header}</legend>
      <p id={prefix + "-prompt"} className="text-base">
        {question.prompt}
      </p>
      {question.isMultiple ? (
        <div role="group" aria-labelledby={prefix + "-prompt"} className="flex flex-col gap-2">
          {choices}
        </div>
      ) : question.options.length ? (
        <RadioGroup
          value={value.isOther ? "other" : selectedIndex < 0 ? null : String(selectedIndex)}
          onValueChange={choose}
          aria-labelledby={prefix + "-prompt"}
          disabled={disabled}
        >
          {choices}
          {question.allowsOther ? (
            <div className="flex items-center gap-2">
              <RadioGroupItem id={prefix + "-other"} value="other" />
              <label htmlFor={prefix + "-other"} className="text-base">
                Other answer
              </label>
            </div>
          ) : null}
        </RadioGroup>
      ) : null}
      {question.isMultiple && question.allowsOther ? (
        <div className="flex items-center gap-2">
          <Checkbox
            id={prefix + "-other"}
            checked={value.isOther}
            disabled={disabled}
            onCheckedChange={(checked: boolean) => onChange({ ...value, isOther: checked })}
          />
          <label htmlFor={prefix + "-other"} className="text-base">
            Other answer
          </label>
        </div>
      ) : null}
      {!question.options.length || value.isOther ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={prefix + "-input"} className="text-xs">
            {question.options.length ? "Other answer" : "Answer"}
          </label>
          <Input
            id={prefix + "-input"}
            aria-describedby={prefix + "-prompt"}
            type={question.isSecret ? "password" : "text"}
            value={value.other}
            disabled={disabled}
            autoComplete={question.isSecret ? "off" : undefined}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange({ ...value, other: event.currentTarget.value, isOther: true })
            }
          />
        </div>
      ) : null}
    </fieldset>
  );
}
