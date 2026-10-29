/** Cover while somebody is on leave, over HTTP. #226. NFR DAT 03. */

import { type Request, type Response, Router } from 'express';
import { actorOf } from '../../../core/http/identify.js';
import type { CoverClash } from './cover.js';
import type { Colleague, CoverChoices, CoverPlan, CoverService } from './cover.service.js';

export interface CoverRoutes {
  cover: CoverService;
}

export function coverRoutes({ cover }: CoverRoutes): Router {
  const routes = Router();

  routes.get('/requests/:id/cover', (request: Request, response: Response, next) => {
    void cover
      .forRequest(actorOf(response), String(request.params.id))
      .then((plan) => {
        response.json(planAsJson(plan));
      })
      .catch(next);
  });

  /* The whole cover for the request, replacing what stood. No parts clears it. */
  routes.put('/requests/:id/cover', (request: Request, response: Response, next) => {
    void cover
      .name(actorOf(response), String(request.params.id), request.body)
      .then((plan) => {
        response.json(planAsJson(plan));
      })
      .catch(next);
  });

  /* Who could be named for somebody: yourself unless `employeeId` says otherwise. */
  routes.get('/cover/colleagues', (request: Request, response: Response, next) => {
    void cover
      .choices(actorOf(response), absenteeIn(request, response))
      .then((choices) => {
        response.json(choicesAsJson(choices));
      })
      .catch(next);
  });

  routes.get('/cover/clashes', (request: Request, response: Response, next) => {
    void cover
      .clashes(actorOf(response), {
        absenteeId: absenteeIn(request, response),
        coverId: request.query.coverId,
        from: request.query.from,
        to: request.query.to,
      })
      .then((clashes) => {
        response.json({ clashes: clashes.map(clashAsJson) });
      })
      .catch(next);
  });

  return routes;
}

/** Field by field, so a field added to the domain reaches the screen only when it is meant to. */
function planAsJson(plan: CoverPlan): unknown {
  return {
    leaveRequestId: plan.leaveRequestId,
    absenteeId: plan.absenteeId,
    /** Ten characters each. */
    from: plan.from,
    to: plan.to,
    parts: plan.parts.map((part) => ({
      coverId: part.coverId,
      from: part.from,
      to: part.to,
      cover: colleagueAsJson(part.cover),
    })),
    clashes: plan.clashes.map(clashAsJson),
    mayChange: plan.mayChange,
  };
}

function choicesAsJson(choices: CoverChoices): unknown {
  return {
    colleagues: choices.colleagues.map(colleagueAsJson),
    suggestedId: choices.suggestedId,
  };
}

function colleagueAsJson(colleague: Colleague): unknown {
  return {
    employeeId: colleague.employeeId,
    firstName: colleague.firstName,
    lastName: colleague.lastName,
    jobTitle: colleague.jobTitle,
  };
}

function clashAsJson(clash: CoverClash): unknown {
  return { coverId: clash.coverId, from: clash.from, to: clash.to };
}

/** Whose leave the question is about: the one named, or the session's own. */
function absenteeIn(request: Request, response: Response): string {
  const named = request.query.employeeId;

  return typeof named === 'string' && named !== '' ? named : (actorOf(response).employeeId ?? '');
}
