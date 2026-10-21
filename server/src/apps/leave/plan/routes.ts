/** Planning leave, over HTTP. A person's own plans, under `/me`. */

import { type Request, type Response, Router } from 'express';
import { actorOf } from '../../../core/http/identify.js';
import type { LeaveYear } from '../leave-year/leave-year.js';
import type { LeavePlan } from './plan.js';
import type { LeavePlanService, PlanBook } from './plan.service.js';

export interface PlanRoutes {
  plans: LeavePlanService;
}

export function planRoutes({ plans }: PlanRoutes): Router {
  const routes = Router();

  routes.get('/me/plans', (request: Request, response: Response, next) => {
    void plans
      .forEmployee(actorOf(response), employeeIdOf(response), oneYearIn(request))
      .then((book) => {
        response.json(bookAsJson(book));
      })
      .catch(next);
  });

  routes.post('/me/plans', (request: Request, response: Response, next) => {
    void plans
      .add(actorOf(response), employeeIdOf(response), bodyOf(request))
      .then((plan) => {
        response.status(201).json(planAsJson(plan));
      })
      .catch(next);
  });

  routes.put('/me/plans/:id', (request: Request, response: Response, next) => {
    void plans
      .change(actorOf(response), employeeIdOf(response), String(request.params.id), bodyOf(request))
      .then((plan) => {
        response.json(planAsJson(plan));
      })
      .catch(next);
  });

  routes.delete('/me/plans/:id', (request: Request, response: Response, next) => {
    void plans
      .remove(actorOf(response), employeeIdOf(response), String(request.params.id))
      .then(() => {
        response.status(204).end();
      })
      .catch(next);
  });

  return routes;
}

function bookAsJson(book: PlanBook): unknown {
  return {
    year: yearAsJson(book.year),
    years: book.years.map(yearAsJson),
    plans: book.plans.map((line) => ({
      ...planAsJson(line.plan),
      typeName: line.typeName,
      countingBasisLabel: line.countingBasisLabel,
      days: line.days,
    })),
    totals: book.totals,
  };
}

function planAsJson(plan: LeavePlan): Record<string, unknown> {
  return {
    planId: plan.id,
    leaveTypeId: plan.leaveTypeId,
    /** Ten characters. NFR DAT 03. */
    from: plan.from,
    to: plan.to,
    note: plan.note,
  };
}

function yearAsJson(year: LeaveYear): unknown {
  return {
    id: year.id,
    label: year.label,
    startDate: year.startDate,
    endDate: year.endDate,
    isClosed: year.isClosed,
  };
}

/** Whose session this is; `/me` names nobody else. */
function employeeIdOf(response: Response): string {
  const { employeeId } = actorOf(response);

  if (employeeId === null) {
    throw new Error('This route was reached by an actor with no employee behind it.');
  }

  return employeeId;
}

function oneYearIn(request: Request): string | undefined {
  const value = request.query.leaveYearId;

  return typeof value === 'string' && value !== '' ? value : undefined;
}

function bodyOf(request: Request): Record<string, unknown> {
  const body: unknown = request.body;

  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}
