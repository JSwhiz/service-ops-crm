import React, { useId } from 'react';

import { SearchableSelect } from './searchable-select';

type SearchableSelectProps = React.ComponentProps<typeof SearchableSelect>;

/**
 * SearchableSelect with the same visible label and error rhythm as Field. The
 * trigger keeps its accessible name through SearchableSelect's hideLabel mode.
 */
export function SelectField({ error, ...props }: SearchableSelectProps & { error?: string }): React.JSX.Element {
  const errorId = useId();
  return (
    <div className="ui-field" aria-describedby={error ? errorId : undefined}>
      <span className="ui-field__label" aria-hidden="true">
        {props.label}
        {props.required ? <span className="ui-field__required"> *</span> : null}
      </span>
      <SearchableSelect {...props} hideLabel />
      {error ? <div id={errorId} className="ui-field__error" role="alert">{error}</div> : null}
    </div>
  );
}
