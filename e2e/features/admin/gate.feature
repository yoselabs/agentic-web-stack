Feature: Admin dashboard gate

  Scenario: Unauthenticated user cannot access /admin/queues
    Given I am not signed in
    When I request the admin queues endpoint without a session
    Then the admin response status is 403

  Scenario: Authenticated non-admin user cannot access /admin/queues
    Given I am signed in as "admin-gate-nonadmin@example.com"
    When I request the admin queues endpoint
    Then the admin response status is 403

  Scenario: Seeded admin can access /admin/queues and see queues
    Given I am signed in as "admin-gate-alice@example.com"
    And I promote "admin-gate-alice@example.com" to admin
    When I request the admin queues API endpoint
    Then the admin response status is 200
    And the admin page contains "email"
    And the admin page contains "maintenance"
