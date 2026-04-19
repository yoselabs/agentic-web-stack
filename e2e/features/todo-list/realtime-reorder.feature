Feature: Realtime reorder propagation

  The todo-reorder operation publishes a todos-reordered event to all
  list subscribers. Both owner-initiated and collaborator-initiated
  reorders must propagate within the 3s realtime tolerance.

  Scenario: Collaborator reorder propagates to owner in realtime
    Given "alice" is signed up and signed in as "alice-rt-reorder" with email "alice-rt-reorder@example.com"
    And "bob" is signed up and signed in as "bob-rt-reorder" with email "bob-rt-reorder@example.com"
    And "alice" has a list named "Groceries"
    And "bob" is a collaborator on "Groceries"
    And "Groceries" has a todo "Milk"
    And "Groceries" has a todo "Eggs"
    And "Groceries" has a todo "Bread"
    And "alice" has "Groceries" open in a browser
    And "bob" has "Groceries" open in a browser
    When "bob" drags "Bread" above "Milk"
    Then "Bread" appears before "Milk" for "alice" within 3 seconds
