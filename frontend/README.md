# Frontend

Use HTML, CSS and JavaScript. Split the frontend tasks between the two frontend
teammates and choose the pages and folder layout together.

Use the [API notes](../docs/03-api-contract.md) for mock data and integration.
Keep six-digit numbers as strings. The backend handles permissions, trusted
prices, stock changes and drawing secrets; browser checks are only for usability.
Checkout requests select quantities, but successful responses contain one ticket
per purchased copy. A grouped history display counts those tickets rather than
reading a stored LotteryTicket.Quantity. Inventory uses availableQuantity.
