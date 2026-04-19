Feature: Realtime todo sync across collaborators

  Payload-shaped events push todo CRUD to peer tabs. Receiving tab patches
  cache via setQueryData — no refetch on the hot path. Tolerance is 3s
  (handover §24 — realistic floor given WS round-trip + React Query
  retry backoff).

  Scenario: Alice creates a todo, Bob sees it in real time
    Given "alice" is signed up and signed in as "alice-rt-create" with email "alice-rt-create@example.com"
    And "bob" is signed up and signed in as "bob-rt-create" with email "bob-rt-create@example.com"
    And "alice" has a list named "Groceries"
    And "bob" is a collaborator on "Groceries"
    And "alice" has "Groceries" open in a browser
    And "bob" has "Groceries" open in a browser
    When "alice" creates the todo "Milk"
    Then "bob" sees "Milk" within 3 seconds

  Scenario: Alice deletes a todo, Bob sees it disappear in real time
    Given "alice" is signed up and signed in as "alice-rt-delete" with email "alice-rt-delete@example.com"
    And "bob" is signed up and signed in as "bob-rt-delete" with email "bob-rt-delete@example.com"
    And "alice" has a list named "Groceries"
    And "bob" is a collaborator on "Groceries"
    And "Groceries" has a todo "Milk"
    And "alice" has "Groceries" open in a browser
    And "bob" has "Groceries" open in a browser
    When "alice" deletes the todo "Milk"
    Then "bob" does not see "Milk" within 3 seconds

  Scenario: Alice imports todos from CSV, Bob sees them at the top in real time
    Given "alice" is signed up and signed in as "alice-rt-import" with email "alice-rt-import@example.com"
    And "bob" is signed up and signed in as "bob-rt-import" with email "bob-rt-import@example.com"
    And "alice" has a list named "Groceries"
    And "bob" is a collaborator on "Groceries"
    And "Groceries" has a todo "Existing item"
    And "alice" has "Groceries" open in a browser
    And "bob" has "Groceries" open in a browser
    When "alice" imports a CSV with titles "Bread,Cheese,Eggs"
    Then "bob" sees "Bread" within 3 seconds
    And "Bread" appears before "Existing item" for "bob"

  Scenario: Bob on index page sees Alice's new todo on first navigation
    Given "alice" is signed up and signed in as "alice-rt-cold" with email "alice-rt-cold@example.com"
    And "bob" is signed up and signed in as "bob-rt-cold" with email "bob-rt-cold@example.com"
    And "alice" has a list named "Groceries"
    And "bob" is a collaborator on "Groceries"
    And "alice" has "Groceries" open in a browser
    And "bob" has the todo lists index open in a browser
    When "alice" creates the todo "Milk"
    And "bob" opens "Groceries"
    Then "bob" sees "Milk" within 3 seconds
