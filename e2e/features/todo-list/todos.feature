Feature: Todo Management

  Scenario: Empty state shows no todos in a list
    Given I am signed in as "empty-todos@example.com"
    And I am on the todo lists page
    And I have a list named "Empty List"
    And I am in the list "Empty List"
    Then I should see "No todos yet"

  Scenario: Create a todo
    Given I am signed in as "create-todo@example.com"
    And I am on the todo lists page
    And I have a list named "Test List"
    And I am in the list "Test List"
    When I fill in "Add a todo..." with "Buy groceries"
    And I click "Add"
    Then I should see "Buy groceries"

  Scenario: Complete a todo
    Given I am signed in as "complete-todo@example.com"
    And I am on the todo lists page
    And I have a list named "Test List"
    And I am in the list "Test List"
    And I have a todo "Write tests"
    When I toggle the todo "Write tests"
    Then the todo "Write tests" should be completed

  Scenario: Delete a todo
    Given I am signed in as "delete-todo@example.com"
    And I am on the todo lists page
    And I have a list named "Test List"
    And I am in the list "Test List"
    And I have a todo "Old task"
    When I delete the todo "Old task"
    Then I should not see "Old task"

  Scenario: Todos are private to each user
    Given I am signed in as "private-todos@example.com"
    And I am on the todo lists page
    And I have a list named "Private List"
    And I am in the list "Private List"
    And I have a todo "My private task"
    When I sign out and sign in as "other-user@example.com"
    And I am on the todo lists page
    Then I should not see "My private task"

  Scenario: Reorder todos by dragging
    Given I am signed in as "reorder-todos@example.com"
    And I am on the todo lists page
    And I have a list named "Reorder List"
    And I am in the list "Reorder List"
    And I have a todo "First task"
    And I have a todo "Second task"
    When I drag "Second task" above "First task"
    Then "Second task" should appear before "First task"

  Scenario: Import todos from CSV
    Given I am signed in as "import-todos@example.com"
    And I am on the todo lists page
    And I have a list named "Import List"
    And I am in the list "Import List"
    When I import todos from "import-todos.csv"
    Then I should see "Buy milk"
    And I should see "Walk the dog"

  Scenario: Export todos as CSV
    Given I am signed in as "export-todos@example.com"
    And I am on the todo lists page
    And I have a list named "Export List"
    And I am in the list "Export List"
    And I have a todo "Export me"
    When I export todos
    Then the downloaded file should contain "Export me"
