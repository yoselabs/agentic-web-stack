Feature: Navigating back to a list refreshes its content

  The list-detail route invalidates `todoList.get` and `todo.list` on
  mount so that stale data from a prior visit is replaced with the
  authoritative snapshot — catching mutations by collaborators that
  landed while the viewer was away from the page.

  Scenario: Todo added while off the detail page appears on return
    Given "alice" is signed up and signed in as "alice-rt-navback" with email "alice-rt-navback@example.com"
    And "bob" is signed up and signed in as "bob-rt-navback" with email "bob-rt-navback@example.com"
    And "alice" has a list named "Groceries navback"
    And "bob" is a collaborator on "Groceries navback"
    And "alice" has "Groceries navback" open in a browser
    When "alice" navigates to the dashboard
    And "bob" creates the todo "Milk" in "Groceries navback" in another browser
    And "alice" navigates back to "Groceries navback"
    Then "alice" sees "Milk" in the list
