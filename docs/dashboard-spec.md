# Dashboard And Report Spec

This document defines what Athena's dashboards and reports should help operators understand.

## Purpose

The dashboard is not the product core.

Its job is to make the autonomous loop legible by showing:
- current goal and run state
- active proposals
- current evidence and decisions
- execution and verification status
- blocked or risky items that need attention

## Required Views

- active runs
- proposal queue
- automation mode and policy state
- current execution status
- verification results
- next actions
- recent failures and recovery state

## Report Rule

A report should explain:
- what Athena tried
- why it tried it
- what evidence supported the move
- what result it observed
- what it intends to do next
