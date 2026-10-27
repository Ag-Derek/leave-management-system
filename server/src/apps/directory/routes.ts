/** The staff directory, over HTTP. NFR DAT 03. */

import { type Request, type Response, Router } from 'express';
import { actorOf } from '../../core/http/identify.js';
import type { DepartmentInTheDirectory, Directory, DirectoryEntry } from './directory.js';
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

  return routes;
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
  };
}

function departmentAsJson(department: DepartmentInTheDirectory): unknown {
  return { id: department.id, name: department.name };
}
