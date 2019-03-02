import {Component, OnInit, ViewChild} from '@angular/core';
import {MatIconRegistry, MatSort, MatTableDataSource} from '@angular/material';
import {DownloadStatus, PcsService} from '../../providers/pcs.service';
import {BrowserWindow, remote} from 'electron';
import * as path from 'path';
import {Router} from '@angular/router';
import {SelectionModel} from '@angular/cdk/collections';
import {IconAssociations} from '../../lib/IconAssociations';
import {DomSanitizer} from '@angular/platform-browser';
import {interval} from 'rxjs';

enum PageEnum {
  ALL,
  DOWNLOAD,
  UPLOAD,
  FINISH
}

export interface FileItem {
  category: number
  dir_empty: number
  empty: number
  fs_id: number
  isdir: number
  local_ctime: number
  local_mtime: number
  oper_id: number
  path: string
  server_ctime: number
  server_filename: string
  server_mtime: number
  share: number
  size: number
  unlist: number
  iconName: string
}

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {

  constructor(private pcsService: PcsService, private router: Router,
              iconRegistry: MatIconRegistry, sanitizer: DomSanitizer) {
    this.path = window.require('path');
    this.remote = window.require('electron').remote;
    this.BrowserWindow = window.require('electron').remote.BrowserWindow;
    this.user = this.user ? this.user : {};
    this.quota = {
      total: 0,
      free: 0,
      used: 0,
    };
    iconRegistry.addSvgIcon('defaultFileIcon', sanitizer.bypassSecurityTrustResourceUrl('assets/folderIcons/default.svg'));
    iconRegistry.addSvgIcon('generatedFolder', sanitizer.bypassSecurityTrustResourceUrl('assets/folderIcons/generated.svg'));
    iconRegistry.addSvgIcon('packagesFolder', sanitizer.bypassSecurityTrustResourceUrl('assets/folderIcons/packages.svg'));
    iconRegistry.addSvgIcon('audioFolder', sanitizer.bypassSecurityTrustResourceUrl('assets/folderIcons/audio.svg'));
    iconRegistry.addSvgIcon('imagesFolder', sanitizer.bypassSecurityTrustResourceUrl('assets/folderIcons/images.svg'));
    iconRegistry.addSvgIcon('videoFolder', sanitizer.bypassSecurityTrustResourceUrl('assets/folderIcons/video.svg'));
    iconRegistry.addSvgIcon('resourceFolder', sanitizer.bypassSecurityTrustResourceUrl('assets/folderIcons/resource.svg'));
    for (const i in IconAssociations) {
      const iconConfig = IconAssociations[i];
      iconRegistry.addSvgIcon(
        `fileIcon${i}`,
        sanitizer.bypassSecurityTrustResourceUrl(`assets${iconConfig._icon}`));
    }
  }

  @ViewChild(MatSort) set matSort(ms: MatSort) {
    this.sort = ms;
    this.sort1 = ms;
    this.setDataSourceAttributes();
  }

  public OneG = 1073741824;
  public OneM = 1048576;
  public OneK = 1024;
  currentPage = PageEnum.ALL;
  PageEnum = PageEnum;
  downloadTableColumns: string[] = ['select', 'fileName', 'totalLength', 'status'];
  downloadTableDataSource = new MatTableDataSource(new Array<DownloadStatus>());
  downloadSelection = new SelectionModel<DownloadStatus>(true, []);
  displayedColumns: string[] = ['select', 'server_filename', 'size', 'server_mtime'];
  dataSource = new MatTableDataSource(new Array<FileItem>());
  selection = new SelectionModel<FileItem>(true, []);
  user: any;
  quota: any;
  BrowserWindow: typeof BrowserWindow;
  path: typeof path;
  private sort: MatSort;
  private sort1: MatSort;
  private remote: typeof remote;
  private currentPath = '/';
  private steps: string[] = []; // store back forward path
  loadingList = false;
  downloadObservable = interval(1000);
  isObserving = false;

  setDataSourceAttributes() {
    this.dataSource.sort = this.sort;
    this.downloadTableDataSource.sort = this.sort1;
  }

  getFileIconName = (server_filename: string) => {
    for (const i in IconAssociations) {
      const iconConfig = IconAssociations[i];
      const re = new RegExp(iconConfig._pattern);
      const match = server_filename.match(re);
      if (match && match.length > 0) {
        return 'fileIcon' + i;
      }
    }
    return 'defaultFileIcon';
  };

  getFolderIconName = (fileItem: FileItem) => {
    const p = this.path.parse(fileItem.path);
    if (p.dir !== '/') {
      return '';
    }
    if (fileItem.server_filename === '我的资源') {
      return 'resourceFolder';
    }
    if (fileItem.server_filename === '我的音乐') {
      return 'audioFolder';
    }
    if (fileItem.server_filename === '我的视频') {
      return 'videoFolder';
    }
    if (fileItem.server_filename === '我的照片') {
      return 'imagesFolder';
    }
    if (fileItem.server_filename === 'apps') {
      return 'packagesFolder';
    }
    if (fileItem.server_filename.startsWith('来自：')) {
      return 'generatedFolder';
    }
    return '';
  };

  async ngOnInit() {
    await this.pcsService.initPcs();
    this.user = this.pcsService.getCurrentUser();
    if (!this.user) {
      await this.router.navigate(['']);
      return;
    }
    this.updateQuota();
    this.cd(this.currentPath);
  }

  async updateQuota() {
    const data = await this.pcsService.getQuota();
    if (data && !data.errno) {
      this.quota = {
        total: (data.total / this.OneG).toFixed(1),
        free: (data.free / this.OneG).toFixed(1),
        used: (data.used / this.OneG).toFixed(1)
      };
    } else {
      console.error('getQuota: ', data);
    }
  }

  getSizeText(size: number) {
    if (size === 0) {
      return '-';
    }
    if (size < this.OneM) {
      return (size / this.OneK).toFixed(1) + 'KB';
    }
    if (size < this.OneG) {
      return (size / this.OneM).toFixed(1) + 'MB';
    }
    return (size / this.OneG).toFixed(1) + 'GB';
  }

  onClickItem(fileItem: FileItem) {
    if (this.loadingList) {
      return;
    }
    console.log(fileItem);
    this.steps = [];
    let dir = '/';
    if (!fileItem) {
      this.cd('/');
      this.selection.clear();
      return;
    }
    if (fileItem && fileItem.isdir) {
      dir = fileItem.path;
      this.cd(dir);
      this.selection.clear();
      return;
    }

    this.download(fileItem);
  }

  fileSaveAs(fileName): string {
    const toLocalPath = this.path.resolve(this.remote.app.getPath('downloads'), fileName);
    return this.remote.dialog.showSaveDialog({defaultPath: toLocalPath});
  }

  async cd(dir: string): Promise<boolean> {
    this.loadingList = true;
    const data = await this.pcsService.getList(dir);
    this.loadingList = false;
    console.log('getList ', data);
    if (data && !data.errno) {
      // console.log('currentDir ' + this.currentPath);
      // console.log('gotoDir ' + dir);
      this.dataSource.data = data.list;
      this.currentPath = dir;
      for (const i in this.dataSource.data) {
        const item = this.dataSource.data[i];
        const server_filename = item.server_filename;
        let iconName = '';
        if (item.isdir) {
          iconName = this.getFolderIconName(item);
        } else {
          iconName = this.getFileIconName(server_filename);
        }
        item.iconName = iconName;
      }
      return true;
    } else {
      console.error('getList', data);
    }
    return false;
  }

  logout() {
    this.pcsService.logout(this.user.username);
    this.router.navigate(['']);
  }

  async goBack() {
    if (this.loadingList) {
      return;
    }
    if (this.currentPath === '/') {
      return;
    }
    const newPath = this.path.resolve(this.currentPath, '..');
    const p = this.path.parse(this.currentPath);
    this.steps.push(p.name);
    await this.cd(newPath);
  }

  async goForward() {
    if (this.loadingList) {
      return;
    }
    if (this.steps.length < 1) {
      return;
    }
    const newPath = this.path.resolve(this.currentPath, this.steps[this.steps.length - 1]);
    if (await this.cd(newPath)) {
      this.steps.pop();
    }
  }

  upload() {

  }

  cloud_download() {

  }

  mkdir() {

  }

  search() {

  }

  share() {

  }

  async pauseDl() {
    if (this.downloadSelection.isEmpty()) {
      console.log(await this.pcsService.pauseAll());
    } else {
      this.downloadSelection.selected.forEach(async (d) => {
        if (d.status === 'active') {
          await this.pcsService.pause(d.gid);
        }
      });
    }
  }

  async unPauseDl() {
    if (this.downloadSelection.isEmpty()) {
      await this.pcsService.unpauseAll();
    } else {
      this.downloadSelection.selected.forEach(async (d) => {
        if (d.status === 'paused') {
          await this.pcsService.unpause(d.gid);
        }
      });
      const isActive = await this.updateDownloadHistoryTable();
      if (isActive) {
        this.observeDownload();
      }
    }
  }

  async removeDl() {
    if (this.downloadSelection.isEmpty()) {
      this.downloadTableDataSource.data.forEach(async (d) => {
        await this.pcsService.remove(d.gid);
      });
    } else {
      this.downloadSelection.selected.forEach(async (d) => {
        await this.pcsService.remove(d.gid);
      });
    }
    const isActive = await this.updateDownloadHistoryTable();
    if (isActive) {
      this.observeDownload();
    }

  }

  async download(fileItem: FileItem) {
    console.log(fileItem);
    if (!fileItem.isdir) {
      const savePath = this.fileSaveAs(fileItem.server_filename);
      console.log(savePath);
      if (savePath) {
        await this.pcsService.download(fileItem.path, savePath);
        this.observeDownload();
      }
    }
  }

  downloadAllSelect() {
    if (this.selection.isEmpty()) {
      return;
    }
    this.selection.selected.forEach((fileItem) => {
      this.download(fileItem);
    });
  }

  async refresh() {
    if (this.loadingList) {
      return;
    }
    await this.cd(this.currentPath);
  }


  /** Whether the number of selected elements matches the total number of rows. */
  isAllSelected(selection: any, dataSource: MatTableDataSource<any>) {
    const numSelected = selection.selected.length;
    const numRows = dataSource.data.length;
    return numSelected === numRows;
  }

  /** Selects all rows if they are not all selected; otherwise clear selection. */
  masterToggle(selection: any, dataSource: MatTableDataSource<any>) {
    this.isAllSelected(selection, dataSource) ?
      selection.clear() :
      dataSource.data.forEach(row => selection.select(row));
  }

  async clickNavMenu(currentPage: PageEnum) {
    this.currentPage = currentPage;
    switch (currentPage) {
      case this.PageEnum.DOWNLOAD:
        const isActive = await this.updateDownloadHistoryTable();
        if (isActive) {
          this.observeDownload();
        }
        break;
    }
  }

  async updateDownloadHistoryTable(): Promise<boolean> {
    let result = [];
    const active = await this.pcsService.tellActive();
    const stoped = await this.pcsService.tellStopped(0, 100);
    const waiting = await this.pcsService.tellWaiting(0, 100);
    result = result.concat(stoped);
    result = result.concat(active);
    result = result.concat(waiting);

    for (const i in result) {
      const files = result[i].files;
      if (files.length > 0) {
        const p = this.path.parse(files[0].path);
        result[i].fileName = p.base;
      }

    }
    this.downloadTableDataSource.data = result;
    this.downloadSelection.clear();
    return active.length > 0;
  }

  observeDownload() {
    if (this.isObserving) {
      return;
    }
    this.isObserving = true;
    const sb = this.downloadObservable.subscribe(async () => {
      const active = await this.pcsService.tellActive();
      if (active.length === 0) {
        sb.unsubscribe();
        this.isObserving = false;
      } else {
        for (const i in active) {
          for (const j in this.downloadTableDataSource.data) {
            if (this.downloadTableDataSource.data[j].gid === active[i].gid) {
              this.downloadTableDataSource.data[j].completedLength = active[i].completedLength;
              break;
            }
          }
        }
      }
    });
  }
}
