Feature: Dashboard inbox keeps list counters fresh across collaborators

  The dashboard subscribes to the user-inbox channel and invalidates the
  accessible-lists query on counter-changed events. When the owner is on
  the dashboard and a collaborator mutates a shared list, the counter on
  the todo lists index reflects the new count on next navigation (within
  the stale-while-revalidate window).

  Scenario: Owner sees counter reflect collaborator's new todo after inbox event
    Given "alice" is signed up and signed in as "alice-rt-dashboard" with email "alice-rt-dashboard@example.com"
    And "bob" is signed up and signed in as "bob-rt-dashboard" with email "bob-rt-dashboard@example.com"
    And "alice" has a list named "Groceries counter"
    And "bob" is a collaborator on "Groceries counter"
    And "Groceries counter" has a todo "Milk"
    And "Groceries counter" has a todo "Bread"
    And "alice" has the dashboard open in a browser
    When "bob" creates the todo "Cheese" in "Groceries counter" in another browser
    And "alice" opens the todo lists page
    Then "alice" sees "Groceries counter" with 3 todos within 5 seconds
