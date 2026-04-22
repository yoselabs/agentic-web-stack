Feature: Activity feed on todo list

  Members of a todo list see an append-only feed of what other members do —
  creates, checks, renames, membership changes. The feed is resumable: a client
  who was offline while events happened sees those events stream in on reconnect,
  in order, without a full page refetch.

  Background:
    Given Alice has a todo list "Groceries"
    And Bob is a collaborator on "Groceries"

  @activity-feed
  Scenario: Live events appear as other members act
    Given a user "Alice" with email "alice-live@example.com"
    And a user "Bob" with email "bob-live@example.com"
    And Alice is signed in and viewing "Groceries"
    And Bob is signed in in a second browser and viewing "Groceries"
    When Bob adds a todo "buy milk"
    Then Alice sees an activity entry "Bob added buy milk" within 3 seconds
    When Bob checks the todo "buy milk"
    Then Alice sees an activity entry "Bob completed buy milk" within 3 seconds

  @activity-feed @resume
  Scenario: Missed events replay in order on reconnect
    Given a user "Alice" with email "alice-resume@example.com"
    And a user "Bob" with email "bob-resume@example.com"
    And Alice is signed in and viewing "Groceries"
    And Bob is signed in in a second browser and viewing "Groceries"
    When Alice's websocket is severed
    And Bob adds a todo "buy bread"
    And Bob adds a todo "buy eggs"
    And Bob checks the todo "buy bread"
    And Alice's websocket reconnects
    Then within 5 seconds Alice sees activity entries in this order:
      | Bob added buy bread        |
      | Bob added buy eggs         |
      | Bob completed buy bread    |
    And Alice's todo query was not refetched during reconnect

  @activity-feed
  Scenario: Revoked member stops receiving activity
    Given a user "Alice" with email "alice-revoked@example.com"
    And a user "Bob" with email "bob-revoked@example.com"
    And Alice is signed in and viewing "Groceries"
    And Bob is signed in in a second browser and viewing "Groceries"
    When Alice removes Bob from the list
    And Alice adds a todo "buy cheese"
    Then Bob does not see the activity entry "Alice added buy cheese"
