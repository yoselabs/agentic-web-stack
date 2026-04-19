Feature: Email retry and dead-letter visibility

  Scenario: Failed invite surfaces in Bull Board and manual retry delivers
    Given "alice" is signed up and signed in as "alice-retry" with email "alice-retry@example.com"
    And I promote "alice-retry@example.com" to admin
    And "bob" is signed up with username "bob-retry" and email "bob-retry@example.com"
    And "alice" has a list named "Retry shopping"
    And Mailpit is stopped
    When "alice" invites "bob" to "Retry shopping"
    Then the "email" queue has 1 failed job within 30 seconds
    And the failed job's error contains "ECONNREFUSED"
    When Mailpit is started again
    And "alice" retries the failed email job
    Then "bob-retry@example.com" receives the invite email
