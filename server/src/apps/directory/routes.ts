/** The staff directory, over HTTP. NFR DAT 03. */

import { type Request, type Response, Router } from 'express';
import { actorOf } from '../../core/http/identify.js';
import type {
  ChartPerson,
  DepartmentInTheDirectory,
  Directory,
  DirectoryEntry,
  MyProfile,
  StaffChart,
} from './directory.js';
import type { DirectoryService } from './directory.service.js';

export interface DirectoryRoutes {
  directory: DirectoryService;
}

export function directoryRoutes({ directory }: DirectoryRoutes): Router {
  const routes = Router();

  /** Everybody at the company today. Behind identify, so a session is needed to ask. */
  routes.get('/directory', (_request: Request, response: Response, next) => {
    void directory
      .read(actorOf(response))
      .then((found) => {
        response.json(directoryAsJson(found));
      })
      .catch(next);
  });

  /** Who reports to whom, among everybody at the company today. */
  routes.get('/directory/chart', (_request: Request, response: Response, next) => {
    void directory
      .chart(actorOf(response))
      .then((chart) => {
        response.json(chartAsJson(chart));
      })
      .catch(next);
  });

  /** My own profile, with the HR-kept facts only I am shown. `/me` names the reader. */
  routes.get('/me/profile', (_request: Request, response: Response, next) => {
    void directory
      .mine(actorOf(response))
      .then((mine) => {
        response.json(profileAsJson(mine));
      })
      .catch(next);
  });

  /**
   * Changing the self-service fields on a record. Only its owner may, and anybody else is
   * answered 403 and logged; the id is in the path so that the refusal has something to
   * refuse. The body is passed on whole for the service to check, so a field HR keeps is
   * named in the refusal rather than dropped on the floor here.
   */
  routes.patch(
    '/people/:employeeId/profile',
    (request: Request<{ employeeId: string }>, response: Response, next) => {
      void directory
        .editProfile(actorOf(response), request.params.employeeId, request.body)
        .then((mine) => {
          response.json(profileAsJson(mine));
        })
        .catch(next);
    },
  );

  return routes;
}

/** Somebody's own profile. Only ever sent to the person it is. */
function profileAsJson(mine: MyProfile): unknown {
  return {
    ...(entryAsJson(mine) as object),
    /** Ten characters. NFR DAT 03. */
    startDate: mine.startDate,
    manager:
      mine.manager === null
        ? null
        : {
            employeeId: mine.manager.employeeId,
            firstName: mine.manager.firstName,
            lastName: mine.manager.lastName,
            jobTitle: mine.manager.jobTitle,
          },
  };
}

/**
 * The whole answer, field by field.
 *
 * Written out rather than sent whole, so that a field added to the domain reaches every
 * employee only when somebody edits this file.
 */
function directoryAsJson(directory: Directory): unknown {
  return {
    today: directory.today,
    people: directory.people.map(entryAsJson),
    departments: directory.departments.map(departmentAsJson),
  };
}

function entryAsJson(entry: DirectoryEntry): unknown {
  return {
    employeeId: entry.employeeId,
    firstName: entry.firstName,
    lastName: entry.lastName,
    jobTitle: entry.jobTitle,
    department: departmentAsJson(entry.department),
    workEmail: entry.workEmail,
    /** Ten characters, or null where they are in. NFR DAT 03. */
    backOn: entry.backOn,
    /** What they keep themselves. Null where they have said nothing. */
    workMobile: entry.workMobile,
    description: entry.description,
  };
}

/** The chart, field by field, for the reason the directory is. */
function chartAsJson(chart: StaffChart): unknown {
  return {
    today: chart.today,
    lines: chart.lines.map((line) => ({ standing: line.standing, top: personAsJson(line.top) })),
    total: chart.total,
  };
}

/**
 * One person and everybody under them.
 *
 * Recursive where the builder is not: the builder is handed whatever the table holds and has
 * to survive a loop, which is infinitely deep until something bounds it. By here every loop is
 * broken, and the depth is the organisation's.
 */
function personAsJson(person: ChartPerson): unknown {
  return {
    employeeId: person.employeeId,
    firstName: person.firstName,
    lastName: person.lastName,
    jobTitle: person.jobTitle,
    reports: person.reports.map(personAsJson),
  };
}

function departmentAsJson(department: DepartmentInTheDirectory): unknown {
  return { id: department.id, name: department.name };
}
