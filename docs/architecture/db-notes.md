# Database Notes

## Important entity separations

### objects vs timesheet values

- object stores the base daily rate
- timesheet stores actual day values

### auto-sync rule

When object daily rate changes:

- non-manually changed timesheet cells may be synchronized
- manually changed cells must remain untouched

## Current timesheet rule

Timesheet is numeric-first:

- one day = one number
- row total is calculated from day cells
- month total is calculated from row totals
